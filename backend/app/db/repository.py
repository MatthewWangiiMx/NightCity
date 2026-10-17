"""Persistence for runs and telemetry. All no-ops while USE_DATABASE=false.

Every function opens its own session and returns early when the session is None,
so a database outage degrades the demo to in-memory instead of breaking it.
"""

import json

from sqlalchemy import text

from app.db.session import get_session
from app.schemas.models import (
    District,
    DispatchAction,
    GridStatus,
    Metrics,
    RunResult,
    ScenarioKind,
    TimeStep,
    WeatherObservation,
)
from app.sim.district import get_district
from app.sim.scenarios import SCENARIOS

# Columns of `telemetry` that come straight off a TimeStep.
_STEP_COLS = (
    "demand_mw",
    "solar_mw",
    "wind_mw",
    "battery_mw",
    "battery_soc",
    "grid_import_mw",
    "indoor_temp_c",
)


def _upsert_district(session, district: District) -> None:
    """runs.district_id is a foreign key, so the district has to exist first."""
    session.execute(
        text(
            "INSERT INTO districts (id, name) VALUES (:id, :name) "
            "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name"
        ),
        {"id": district.id, "name": district.name},
    )
    if not district.assets:
        return
    session.execute(
        text(
            "INSERT INTO assets (id, district_id, name, kind, capacity_mw, x, y) "
            "VALUES (:id, :district_id, :name, :kind, :capacity_mw, :x, :y) "
            "ON CONFLICT (id) DO UPDATE SET "
            "name = EXCLUDED.name, kind = EXCLUDED.kind, "
            "capacity_mw = EXCLUDED.capacity_mw, x = EXCLUDED.x, y = EXCLUDED.y"
        ),
        [
            {"district_id": district.id, **a.model_dump(mode="json")}
            for a in district.assets
        ],
    )


def save_run(result: RunResult) -> None:
    """Insert run metadata, both time series, and the dispatch plan.

    Idempotent: re-saving the same run_id replaces its rows, so a rerun during a
    demo does not accumulate duplicates.
    """
    with get_session() as s:
        if s is None:
            return

        _upsert_district(s, result.district)

        s.execute(
            text(
                "INSERT INTO runs (id, district_id, scenario, optimized, params, "
                "  baseline_metrics, optimized_metrics, grid_status, explanation) "
                "VALUES (:id, :district_id, :scenario, :optimized, CAST(:params AS JSONB), "
                "  CAST(:baseline_metrics AS JSONB), CAST(:optimized_metrics AS JSONB), "
                "  CAST(:grid_status AS JSONB), :explanation) "
                "ON CONFLICT (id) DO UPDATE SET "
                "  scenario = EXCLUDED.scenario, optimized = EXCLUDED.optimized, "
                "  params = EXCLUDED.params, "
                "  baseline_metrics = EXCLUDED.baseline_metrics, "
                "  optimized_metrics = EXCLUDED.optimized_metrics, "
                "  grid_status = EXCLUDED.grid_status, "
                "  explanation = EXCLUDED.explanation"
            ),
            {
                "id": result.run_id,
                "district_id": result.district.id,
                "scenario": result.scenario.kind.value,
                "optimized": bool(result.actions),
                # RunResult carries no knobs today; pass RunRequest.params through
                # here once the What-if Lab sliders are wired up.
                "params": json.dumps({}),
                "baseline_metrics": result.baseline_metrics.model_dump_json(),
                "optimized_metrics": result.optimized_metrics.model_dump_json(),
                "grid_status": result.grid_status.model_dump_json(),
                "explanation": result.explanation,
            },
        )

        # Telemetry and actions are rewritten wholesale for this run.
        s.execute(text("DELETE FROM telemetry WHERE run_id = :run_id"), {"run_id": result.run_id})
        s.execute(
            text("DELETE FROM dispatch_actions WHERE run_id = :run_id"),
            {"run_id": result.run_id},
        )

        rows = [
            {
                "t": step.t,
                "run_id": result.run_id,
                "district_id": result.district.id,
                "asset_id": None,  # district-level aggregate; per-asset rows go here later
                "variant": variant,
                **{c: getattr(step, c) for c in _STEP_COLS},
            }
            for variant, steps in (
                ("baseline", result.baseline),
                ("optimized", result.optimized),
            )
            for step in steps
        ]
        if rows:
            cols = ("t", "run_id", "district_id", "asset_id", "variant", *_STEP_COLS)
            s.execute(
                text(
                    f"INSERT INTO telemetry ({', '.join(cols)}) "
                    f"VALUES ({', '.join(':' + c for c in cols)})"
                ),
                rows,
            )

        if result.actions:
            s.execute(
                text(
                    "INSERT INTO dispatch_actions (id, run_id, kind, title, detail, "
                    "  target_asset, delta_mw, reason, constraint_, assumption) "
                    "VALUES (:id, :run_id, :kind, :title, :detail, "
                    "  :target_asset, :delta_mw, :reason, :constraint_, :assumption)"
                ),
                [
                    {
                        "run_id": result.run_id,
                        "constraint_": a.constraint,
                        **a.model_dump(mode="json", exclude={"constraint"}),
                    }
                    for a in result.actions
                ],
            )


def load_run(run_id: str) -> RunResult | None:
    with get_session() as s:
        if s is None:
            return None

        run = s.execute(
            text(
                "SELECT district_id, scenario, baseline_metrics, optimized_metrics, "
                "       grid_status, explanation "
                "FROM runs WHERE id = :run_id"
            ),
            {"run_id": run_id},
        ).mappings().first()
        if run is None:
            return None

        steps = s.execute(
            text(
                f"SELECT variant, t, {', '.join(_STEP_COLS)} "
                "FROM telemetry WHERE run_id = :run_id AND asset_id IS NULL "
                "ORDER BY t ASC"
            ),
            {"run_id": run_id},
        ).mappings().all()

        actions = s.execute(
            text(
                "SELECT id, kind, title, detail, target_asset, delta_mw, "
                '       reason, constraint_ AS "constraint", assumption '
                "FROM dispatch_actions WHERE run_id = :run_id"
            ),
            {"run_id": run_id},
        ).mappings().all()

        by_variant: dict[str, list[TimeStep]] = {"baseline": [], "optimized": []}
        for row in steps:
            by_variant.setdefault(row["variant"], []).append(
                TimeStep(**{k: v for k, v in row.items() if k != "variant"})
            )

        scenario = SCENARIOS.get(run["scenario"], SCENARIOS[ScenarioKind.BASELINE])

        return RunResult(
            run_id=run_id,
            scenario=scenario,
            district=get_district(run["district_id"]),
            baseline=by_variant["baseline"],
            optimized=by_variant["optimized"],
            baseline_metrics=Metrics(**run["baseline_metrics"]),
            optimized_metrics=Metrics(**run["optimized_metrics"]),
            grid_status=GridStatus(**run["grid_status"]),
            actions=[DispatchAction(**a) for a in actions],
            explanation=run["explanation"],
        )


def recent_telemetry(district_id: str, limit: int = 500) -> list[TimeStep]:
    """Hypertable read: the most recent district-level steps, oldest first."""
    with get_session() as s:
        if s is None:
            return []
        rows = s.execute(
            text(
                f"SELECT t, {', '.join(_STEP_COLS)} FROM telemetry "
                "WHERE district_id = :district_id AND asset_id IS NULL "
                "ORDER BY t DESC LIMIT :limit"
            ),
            {"district_id": district_id, "limit": limit},
        ).mappings().all()
        return [TimeStep(**row) for row in reversed(rows)]


def list_buildings_for_massing(
    *,
    lon_min: float,
    lat_min: float,
    lon_max: float,
    lat_max: float,
    limit: int = 50_000,
) -> list[dict]:
    """Downtown footprints from TigerData `buildings`, as GeoJSON + attributes."""
    with get_session() as s:
        if s is None:
            return []
        rows = s.execute(
            text(
                """
                SELECT id, source_file, source_id, height_m, levels, properties,
                       ST_AsGeoJSON(geom)::json AS geojson
                FROM buildings
                WHERE geom && ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
                  AND ST_Intersects(
                        geom,
                        ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
                      )
                ORDER BY COALESCE(height_m, 0) DESC
                LIMIT :limit
                """
            ),
            {
                "lon_min": lon_min,
                "lat_min": lat_min,
                "lon_max": lon_max,
                "lat_max": lat_max,
                "limit": limit,
            },
        ).mappings().all()
        return [dict(row) for row in rows]


def get_building(building_id: int) -> dict | None:
    """Single TigerData building with footprint GeoJSON."""
    with get_session() as s:
        if s is None:
            return None
        row = s.execute(
            text(
                """
                SELECT id, source_file, source_id, height_m, levels, properties,
                       ST_AsGeoJSON(geom)::json AS geojson,
                       ST_X(ST_Centroid(geom)) AS lon,
                       ST_Y(ST_Centroid(geom)) AS lat,
                       ST_Area(geography(ST_Force2D(geom))) AS footprint_m2
                FROM buildings
                WHERE id = :id
                """
            ),
            {"id": building_id},
        ).mappings().first()
        return dict(row) if row else None


def buildings_count() -> int | None:
    with get_session() as s:
        if s is None:
            return None
        return int(s.execute(text("SELECT count(*) FROM buildings")).scalar() or 0)


def save_weather_observations(observations: list[WeatherObservation]) -> int:
    """Upsert provider observations and return the number of rows received."""
    if not observations:
        return 0
    with get_session() as s:
        if s is None:
            raise RuntimeError("Database is disabled; set USE_DATABASE=true to ingest weather data")
        s.execute(
            text(
                "INSERT INTO weather_observations (observation_time, latitude, longitude, "
                "temperature_2m_c, precipitation_mm, wind_speed_10m_kmh, weather_code) "
                "VALUES (:observation_time, :latitude, :longitude, :temperature_2m_c, "
                ":precipitation_mm, :wind_speed_10m_kmh, :weather_code) "
                "ON CONFLICT (observation_time, latitude, longitude) DO UPDATE SET "
                "temperature_2m_c = EXCLUDED.temperature_2m_c, "
                "precipitation_mm = EXCLUDED.precipitation_mm, "
                "wind_speed_10m_kmh = EXCLUDED.wind_speed_10m_kmh, "
                "weather_code = EXCLUDED.weather_code"
            ),
            [observation.model_dump() for observation in observations],
        )
    return len(observations)
