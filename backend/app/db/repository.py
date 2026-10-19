"""Persistence for runs and telemetry. All no-ops while USE_DATABASE=false.

Every function opens its own session and returns early when the session is None,
so a database outage degrades the demo to in-memory instead of breaking it.
"""

import json
from datetime import datetime

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


def recent_telemetry(
    district_id: str,
    limit: int = 500,
    variant: str = "optimized",
) -> list[TimeStep]:
    """Hypertable read: the most recent district-level steps, oldest first."""
    with get_session() as s:
        if s is None:
            return []
        rows = s.execute(
            text(
                f"SELECT t, {', '.join(_STEP_COLS)} FROM telemetry "
                "WHERE district_id = :district_id AND asset_id IS NULL "
                "  AND variant = :variant "
                "ORDER BY t DESC LIMIT :limit"
            ),
            {"district_id": district_id, "limit": limit, "variant": variant},
        ).mappings().all()
        return [TimeStep(**row) for row in reversed(rows)]


def latest_run_id(district_id: str) -> str | None:
    with get_session() as s:
        if s is None:
            return None
        return s.execute(
            text(
                "SELECT id FROM runs WHERE district_id = :district_id "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"district_id": district_id},
        ).scalar()


def weather_last_ingest_at(latitude: float, longitude: float) -> datetime | None:
    """When this location's forecast was last written, or None if never.

    Drives the once-a-day refresh: Open-Meteo is only called when what we hold
    has gone stale, so ordinary page loads read from TigerData instead of
    hitting the provider on every request.
    """
    with get_session() as s:
        if s is None:
            return None
        row = s.execute(
            text(
                """
                SELECT MAX(created_at) AS last_at
                FROM weather_observations
                WHERE ABS(latitude - :lat) < 0.05 AND ABS(longitude - :lon) < 0.05
                """
            ),
            {"lat": latitude, "lon": longitude},
        ).mappings().first()
    return row["last_at"] if row and row["last_at"] else None


def list_weather_forecast(
    latitude: float,
    longitude: float,
    *,
    days: int = 16,
) -> list[WeatherObservation]:
    """Cached forward-looking hourly weather for a location, oldest first.

    Only hours from the start of today onward: the table also holds the days
    that have already passed, and a forecast page asking for 16 days means the
    next 16, not the last 16.
    """
    with get_session() as s:
        if s is None:
            return []
        rows = s.execute(
            text(
                """
                SELECT observation_time, latitude, longitude, temperature_2m_c,
                       precipitation_mm, wind_speed_10m_kmh, weather_code
                FROM weather_observations
                WHERE ABS(latitude - :lat) < 0.05
                  AND ABS(longitude - :lon) < 0.05
                  AND observation_time >= date_trunc('day', now())
                  AND observation_time < date_trunc('day', now())
                      + make_interval(days => :days)
                ORDER BY observation_time ASC
                """
            ),
            {"lat": latitude, "lon": longitude, "days": days},
        ).mappings().all()
    return [WeatherObservation(**dict(row)) for row in rows]


def list_weather_observations(
    *,
    latitude: float | None = None,
    longitude: float | None = None,
    limit: int = 168,
) -> list[WeatherObservation]:
    """Recent hourly weather from TigerData, oldest first."""
    with get_session() as s:
        if s is None:
            return []

        if latitude is not None and longitude is not None:
            rows = s.execute(
                text(
                    """
                    SELECT observation_time, latitude, longitude, temperature_2m_c,
                           precipitation_mm, wind_speed_10m_kmh, weather_code
                    FROM weather_observations
                    WHERE ABS(latitude - :lat) < 0.05 AND ABS(longitude - :lon) < 0.05
                    ORDER BY observation_time DESC
                    LIMIT :limit
                    """
                ),
                {"lat": latitude, "lon": longitude, "limit": limit},
            ).mappings().all()
        else:
            rows = s.execute(
                text(
                    """
                    SELECT observation_time, latitude, longitude, temperature_2m_c,
                           precipitation_mm, wind_speed_10m_kmh, weather_code
                    FROM weather_observations
                    ORDER BY observation_time DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            ).mappings().all()

        return [WeatherObservation(**dict(row)) for row in reversed(rows)]


def _apply_weather_to_steps(
    steps: list[TimeStep],
    weather: list[WeatherObservation],
) -> list[TimeStep]:
    """Fill missing indoor_temp from nearest outdoor observation (weather proxy)."""
    if not steps or not weather:
        return steps

    out: list[TimeStep] = []
    for step in steps:
        if step.indoor_temp_c is not None:
            out.append(step)
            continue
        nearest = min(
            weather,
            key=lambda w: abs((w.observation_time - step.t).total_seconds()),
        )
        # Only use weather within 2 hours of the step.
        if abs((nearest.observation_time - step.t).total_seconds()) > 7200:
            out.append(step)
            continue
        outdoor = nearest.temperature_2m_c
        if outdoor is None:
            out.append(step)
            continue
        # Simple indoor proxy: outdoor tempered toward comfort band.
        indoor = round(20.5 + (outdoor - 15.0) * 0.18, 2)
        out.append(step.model_copy(update={"indoor_temp_c": indoor}))
    return out


def list_buildings_for_loads(limit: int = 1200) -> list[dict]:
    """Building rows with centroid + footprint for load synthesis."""
    with get_session() as s:
        if s is None:
            return []
        from app.buildings_massing import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN

        rows = s.execute(
            text(
                """
                SELECT id, height_m, levels, properties,
                       ST_X(ST_Centroid(geom)) AS lon,
                       ST_Y(ST_Centroid(geom)) AS lat,
                       ST_Area(geography(ST_Force2D(geom))) AS footprint_m2
                FROM buildings b
                WHERE geom && ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
                ORDER BY COALESCE(height_m, 0) DESC
                LIMIT :limit
                """
            ),
            {
                "lon_min": LON_MIN,
                "lat_min": LAT_MIN,
                "lon_max": LON_MAX,
                "lat_max": LAT_MAX,
                "limit": limit,
            },
        ).mappings().all()
        return [dict(row) for row in rows]


def load_building_profiles(limit: int = 1200):
    """TigerData buildings first; fall back to Explore City massing JSON."""
    from app.sim.building_loads import profiles_from_massing_cache, profiles_from_tiger_rows

    rows = list_buildings_for_loads(limit=limit)
    if rows:
        return profiles_from_tiger_rows(rows, limit=limit), "tigerdata"
    cached = profiles_from_massing_cache(limit=limit)
    if cached:
        return cached, "massing-cache"
    return [], "none"


def load_live_run(district_id: str = "nightcity") -> RunResult | None:
    """Build a RunResult whose demand matches real building stock + weather."""
    from app.sim.building_loads import district_from_buildings, synthesize_steps_from_buildings
    from app.sim.district import get_district
    from app.sim.scenarios import SCENARIOS
    from app.sim.simulator import compute_metrics, grid_status
    from app.schemas.models import ScenarioKind

    weather = list_weather_observations(limit=168)
    profiles, building_source = load_building_profiles()

    # Prefer timesteps synthesized from actual buildings so demand matches the city.
    if profiles:
        district = district_from_buildings(profiles, district_id=district_id)
        baseline = synthesize_steps_from_buildings(profiles, weather, optimized=False)
        optimized = synthesize_steps_from_buildings(profiles, weather, optimized=True)
        if baseline and optimized:
            return RunResult(
                run_id=f"buildings-{district_id}",
                scenario=SCENARIOS[ScenarioKind.BASELINE],
                district=district,
                baseline=baseline,
                optimized=optimized,
                baseline_metrics=compute_metrics(baseline),
                optimized_metrics=compute_metrics(optimized),
                grid_status=grid_status(optimized),
                actions=[],
                explanation=(
                    f"Demand aggregated from {len(profiles)} real buildings "
                    f"({building_source}) with TigerData weather when available."
                ),
                is_simulated=True,
                weather=weather,
                source=f"buildings-{building_source}",
            )

    run_id = latest_run_id(district_id)
    if run_id:
        stored = load_run(run_id)
        if stored is not None and (stored.baseline or stored.optimized):
            baseline = _apply_weather_to_steps(stored.baseline, weather)
            optimized = _apply_weather_to_steps(stored.optimized or baseline, weather)
            return stored.model_copy(
                update={
                    "baseline": baseline,
                    "optimized": optimized,
                    "baseline_metrics": compute_metrics(baseline),
                    "optimized_metrics": compute_metrics(optimized),
                    "grid_status": grid_status(optimized),
                    "weather": weather,
                    "source": "tigerdata-run",
                    "explanation": stored.explanation
                    or "Loaded from TigerData (stored run + weather observations).",
                }
            )

    optimized = recent_telemetry(district_id, limit=500, variant="optimized")
    baseline = recent_telemetry(district_id, limit=500, variant="baseline")
    if not optimized and not baseline:
        return None
    if not optimized:
        optimized = baseline
    if not baseline:
        baseline = optimized

    baseline = _apply_weather_to_steps(baseline, weather)
    optimized = _apply_weather_to_steps(optimized, weather)
    scenario = SCENARIOS[ScenarioKind.BASELINE]

    return RunResult(
        run_id=f"tiger-{district_id}",
        scenario=scenario,
        district=get_district(district_id),
        baseline=baseline,
        optimized=optimized,
        baseline_metrics=compute_metrics(baseline),
        optimized_metrics=compute_metrics(optimized),
        grid_status=grid_status(optimized),
        actions=[],
        explanation="Loaded from TigerData telemetry + weather_observations.",
        is_simulated=True,
        weather=weather,
        source="tigerdata-telemetry",
    )


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
                SELECT b.id, b.source_file, b.source_id, b.height_m, b.levels, b.properties,
                       ST_AsGeoJSON(b.geom)::json AS geojson,
                       bn.transformer_id AS node_id
                FROM buildings b
                LEFT JOIN building_nodes bn ON bn.building_id = b.id
                WHERE b.geom && ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
                  AND ST_Intersects(
                        b.geom,
                        ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
                      )
                ORDER BY COALESCE(b.height_m, 0) DESC
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
                "weather_code = EXCLUDED.weather_code, "
                # Stamped on every write, not just inserts: the refresh check
                # reads MAX(created_at), and a forecast that only revises hours
                # we already hold would otherwise never look fresh.
                "created_at = now()"
            ),
            [observation.model_dump() for observation in observations],
        )
    return len(observations)
