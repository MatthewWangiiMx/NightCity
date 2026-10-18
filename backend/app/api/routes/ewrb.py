"""Ontario EWRB reported energy and water benchmarks.

The only endpoints in NightCity serving measured figures. Everything here is
read straight from the published dataset or derived from it by
`app/sim/ewrb_profile.py`, which labels what it modelled.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.data import ewrb
from app.db import repository
from app.sim import ewrb_profile, plan_levers

router = APIRouter(prefix="/ewrb", tags=["ewrb"])


def _parse_hourly(raw: str | None) -> list[float] | None:
    """Read the 24 hourly temperatures off the query string.

    Sent as a comma-separated list rather than a repeated parameter to keep the
    URL readable. Anything that is not exactly 24 usable numbers is rejected
    outright: a partial day would quietly bias the heating shape towards
    whichever hours happened to survive.
    """
    if not raw:
        return None
    try:
        values = [float(part) for part in raw.split(",") if part.strip() != ""]
    except ValueError:
        return None
    return values if len(values) == 24 else None

SOURCE = {
    "dataset": "Ontario Energy and Water Reporting and Benchmarking (EWRB), 2024 reporting year",
    "publisher": "Government of Ontario",
    "license": "Open Government Licence - Ontario",
    "url": "https://data.ontario.ca/dataset/energy-and-water-reporting-and-benchmarking",
    "note": (
        "Annual totals reported by building operators. Weather-normalised columns are used "
        "for benchmarking. Intensities are converted from GJ/m2 to kWh/m2."
    ),
}


def _require_dataset() -> None:
    if not ewrb.dataset_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "EWRB dataset not found. Expected backend/data/odc_final_dataset_2024.csv "
                f"at {ewrb.DATA_FILE}."
            ),
        )


@router.get("/meta")
def read_meta() -> dict[str, Any]:
    """Dataset provenance, coverage and the property types worth benchmarking."""
    _require_dataset()
    rows = ewrb.load_rows()
    cities: dict[str, int] = {}
    for row in rows:
        if row.city:
            cities[row.city] = cities.get(row.city, 0) + 1
    top_cities = sorted(
        ({"city": c, "count": n} for c, n in cities.items()), key=lambda r: -r["count"]
    )[:25]
    return {
        "source": SOURCE,
        "rows": len(rows),
        "cities": top_cities,
        "property_types": ewrb.property_types(),
        "metrics": ewrb.COHORT_METRICS,
        "min_cohort_size": ewrb.MIN_COHORT_N,
    }


@router.get("/benchmarks")
def read_benchmarks(
    city: str | None = Query("Toronto", description="Narrow cohorts to one city"),
    fsa: str | None = Query(None, description="Narrow further to a postal FSA, e.g. M5V"),
) -> dict[str, Any]:
    """Cohort table the 3D viewer fetches once to price every building it draws.

    One entry per property type, each with the reported distribution and the
    geographic scope it was drawn at.
    """
    _require_dataset()
    cohorts: dict[str, Any] = {}
    for entry in ewrb.property_types():
        ptype = entry["property_type"]
        found = ewrb.cohort(ptype, fsa=fsa, city=city)
        if found:
            cohorts[ptype] = found
    return {
        "source": SOURCE,
        "city": city,
        "fsa": fsa,
        "kind_map": ewrb.KIND_TO_PROPERTY_TYPES,
        "cohorts": cohorts,
    }


@router.get("/cohort")
def read_cohort(
    property_type: str = Query(..., description="EWRB property type, e.g. Office"),
    city: str | None = Query("Toronto"),
    fsa: str | None = Query(None),
) -> dict[str, Any]:
    """One property type's reported distribution."""
    _require_dataset()
    found = ewrb.cohort(property_type, fsa=fsa, city=city)
    if not found:
        raise HTTPException(status_code=404, detail=f"No EWRB rows for '{property_type}'")
    return {"source": SOURCE, **found}


@router.get("/summary")
def read_summary(city: str = Query("Toronto")) -> dict[str, Any]:
    """City-wide reported distributions plus its property-type mix."""
    _require_dataset()
    summary = ewrb.city_summary(city)
    if not summary:
        raise HTTPException(status_code=404, detail=f"No EWRB rows for city '{city}'")
    return {"source": SOURCE, **summary}


@router.get("/fsa")
def read_fsa_breakdown(city: str = Query("Toronto")) -> dict[str, Any]:
    """Median reported intensity per postal FSA - the Plan page's geography view."""
    _require_dataset()
    return {"source": SOURCE, "city": city, "areas": ewrb.fsa_breakdown(city)}


@router.get("/records")
def read_records(
    city: str | None = Query(None),
    fsa: str | None = Query(None),
    property_type: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Raw reported rows, filtered and paged."""
    _require_dataset()
    rows, total = ewrb.filter_rows(
        city=city, fsa=fsa, property_type=property_type, limit=limit, offset=offset
    )
    return {
        "source": SOURCE,
        "total": total,
        "limit": limit,
        "offset": offset,
        "records": [r.as_dict() for r in rows],
    }


@router.get("/profile")
def read_profile(
    building_id: str = Query(..., description="Stable id, e.g. tiger-4821"),
    footprint_m2: float = Query(..., gt=0),
    kind: str | None = Query(None, description="Massing kind: tower, office, residential, ..."),
    name: str = Query("Building"),
    height_m: float | None = Query(None, gt=0),
    levels: int | None = Query(None, ge=1),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    fsa: str | None = Query(None),
    hour: int | None = Query(None, ge=0, le=23),
) -> dict[str, Any]:
    """EWRB-grounded profile for a building the viewer already has geometry for.

    Geometry comes in as query params so the panel works whether or not the
    footprint is in TigerData.
    """
    _require_dataset()
    profile = ewrb_profile.build_profile(
        building_id=building_id,
        name=name,
        kind=kind,
        footprint_m2=footprint_m2,
        height_m=height_m,
        levels=levels,
        lat=lat,
        lon=lon,
        fsa=fsa,
        hour=hour,
    )
    if profile is None:
        raise HTTPException(
            status_code=404, detail=f"No EWRB cohort matches kind '{kind}'"
        )
    return {"source": SOURCE, **profile}


@router.get("/buildings/{building_id}/profile")
def read_building_profile(
    building_id: int,
    hour: int | None = Query(None, ge=0, le=23),
) -> dict[str, Any]:
    """Same profile, for a building already stored in TigerData."""
    _require_dataset()
    row = repository.get_building(building_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Building not found in TigerData (is USE_DATABASE=true and the import run?)",
        )

    footprint = float(row.get("footprint_m2") or 0) or 500.0
    profile = ewrb_profile.build_profile(
        building_id=f"tiger-{building_id}",
        name=f"Building {building_id}",
        kind=None,
        footprint_m2=footprint,
        height_m=float(row["height_m"]) if row.get("height_m") else None,
        levels=int(row["levels"]) if row.get("levels") else None,
        lat=float(row["lat"]) if row.get("lat") else None,
        lon=float(row["lon"]) if row.get("lon") else None,
        hour=hour,
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="No EWRB cohort for this building")
    return {"source": SOURCE, **profile}


@router.post("/buildings/eui")
def read_building_euis(
    buildings: list[dict[str, Any]],
    city: str = Query("Toronto"),
) -> dict[str, Any]:
    """Reported site EUI per building, lean enough to colour a whole city.

    The 3D viewer draws well over a thousand footprints, so this returns only
    what a colour scale needs rather than a full profile each. The scale bounds
    come back with it, computed over this very set, so the ramp spans the
    buildings actually on screen instead of a hardcoded guess.
    """
    _require_dataset()
    if len(buildings) > 6000:
        raise HTTPException(status_code=413, detail="Send at most 6000 buildings per call")

    out: list[dict[str, Any]] = []
    for item in buildings:
        footprint = item.get("footprint_m2")
        if not footprint:
            continue
        profile = ewrb_profile.build_profile(
            building_id=str(item.get("id")),
            name="",
            kind=item.get("kind"),
            footprint_m2=float(footprint),
            height_m=float(item["h"]) if item.get("h") else None,
            levels=int(item["levels"]) if item.get("levels") else None,
            lat=float(item["lat"]) if item.get("lat") else None,
            lon=float(item["lon"]) if item.get("lon") else None,
            city=city,
        )
        if profile is None:
            continue
        eui = profile["intensity"]["site_eui_kwh_m2"]
        if eui is None:
            continue
        out.append(
            {
                "id": profile["building_id"],
                "eui": eui,
                "property_type": profile["property_type"],
                "percentile": profile["benchmark"]["site_eui_percentile"],
                "fsa": profile["fsa"],
            }
        )

    values = sorted(r["eui"] for r in out)
    scale = None
    if values:
        # p05/p95 bounds: a couple of legitimate extremes would otherwise flatten
        # the ramp so that every ordinary building reads as the same colour.
        def pct(q: float) -> float:
            return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]

        scale = {
            "min": values[0],
            "p05": pct(0.05),
            "median": pct(0.50),
            # p75 is the cutoff the viewer paints from: only the worst quarter
            # is coloured, so this bound decides which buildings light up.
            "p75": pct(0.75),
            "p95": pct(0.95),
            "max": values[-1],
            "n": len(values),
        }

    return {"source": SOURCE, "city": city, "scale": scale, "buildings": out}


@router.get("/district/live")
def read_live_district(
    city: str = Query("Toronto"),
    limit: int = Query(1200, ge=1, le=4000),
    target_percentile: float = Query(25.0, ge=0, le=100),
) -> dict[str, Any]:
    """District rollup over the building stock already in TigerData.

    The Simulate and Plan pages have no massing geometry of their own, so they
    read this instead of posting footprints. Absolute totals need floor area and
    EWRB publishes none, so the area comes from the massing table: without the
    database there is no denominator and this answers 503.
    """
    _require_dataset()
    rows = repository.list_buildings_for_loads(limit=limit)
    if not rows:
        raise HTTPException(
            status_code=503,
            detail=(
                "No buildings in TigerData, so there is no floor area to apply reported "
                "intensities to. EWRB publishes intensity only. Set USE_DATABASE=true and "
                "run scripts/buildings/import_builds.py, or call /api/ewrb/summary for "
                "intensity-only figures."
            ),
        )

    profiles: list[dict[str, Any]] = []
    for row in rows:
        footprint = float(row.get("footprint_m2") or 0)
        if footprint <= 0:
            continue
        profile = ewrb_profile.build_profile(
            building_id=f"tiger-{row['id']}",
            name=f"Building {row['id']}",
            kind=None,
            footprint_m2=footprint,
            height_m=float(row["height_m"]) if row.get("height_m") else None,
            levels=int(row["levels"]) if row.get("levels") else None,
            lat=float(row["lat"]) if row.get("lat") else None,
            lon=float(row["lon"]) if row.get("lon") else None,
            city=city,
        )
        if profile is not None:
            profiles.append(profile)

    rollup = ewrb_profile.district_rollup(profiles)
    return {
        "source": SOURCE,
        "city": city,
        "skipped": len(rows) - len(profiles),
        "peak_hour": ewrb_profile.peak_hour(profiles),
        **rollup,
        "retrofit": ewrb_profile.retrofit_potential(profiles, target_percentile),
    }


@router.get("/plan")
def read_plan(
    city: str = Query("Toronto"),
    limit: int = Query(1200, ge=1, le=4000),
    heat_pump_pct: float = Query(0, ge=0, le=100),
    heat_pump_cop: float = Query(3.0, ge=1, le=6),
    retrofit_pct: float = Query(0, ge=0, le=100),
    retrofit_target_percentile: float = Query(25, ge=0, le=100),
    setpoint_widen_c: float = Query(0, ge=0, le=6),
    lighting_retrofit_pct: float = Query(0, ge=0, le=100),
    flex_ev_pct: float = Query(0, ge=0, le=100),
    flex_hvac_pct: float = Query(0, ge=0, le=100),
    flex_industrial_pct: float = Query(0, ge=0, le=100),
    air_quality_floor_pct: float = Query(100, ge=0, le=100),
    lighting_floor_pct: float = Query(100, ge=0, le=100),
    day_temp_c: float | None = Query(None, description="Mean temperature of the selected day"),
    day_weather_code: int | None = Query(None),
    day_wind_kmh: float | None = Query(None, ge=0),
    day_precip_mm: float | None = Query(None, ge=0),
    day_hourly_temps_c: str | None = Query(
        None,
        description="24 comma-separated hourly temperatures, index = hour of day",
    ),
) -> dict[str, Any]:
    """What the Plan page's levers do to the district's measured energy use.

    Reads the building stock from TigerData, applies the reported intensities,
    then runs the levers. Needs the database for the same reason the rollup
    does: EWRB publishes intensity, and absolute totals need floor area.
    """
    _require_dataset()
    rows = repository.list_buildings_for_loads(limit=limit)
    if not rows:
        raise HTTPException(
            status_code=503,
            detail=(
                "No buildings in TigerData, so there is no floor area to apply reported "
                "intensities to. Set USE_DATABASE=true and run the massing import."
            ),
        )

    profiles: list[dict[str, Any]] = []
    for row in rows:
        footprint = float(row.get("footprint_m2") or 0)
        if footprint <= 0:
            continue
        profile = ewrb_profile.build_profile(
            building_id=f"tiger-{row['id']}",
            name=f"Building {row['id']}",
            kind=None,
            footprint_m2=footprint,
            height_m=float(row["height_m"]) if row.get("height_m") else None,
            levels=int(row["levels"]) if row.get("levels") else None,
            lat=float(row["lat"]) if row.get("lat") else None,
            lon=float(row["lon"]) if row.get("lon") else None,
            city=city,
        )
        if profile is not None:
            profiles.append(profile)

    levers = plan_levers.Levers(
        heat_pump_pct=heat_pump_pct,
        heat_pump_cop=heat_pump_cop,
        retrofit_pct=retrofit_pct,
        retrofit_target_percentile=retrofit_target_percentile,
        setpoint_widen_c=setpoint_widen_c,
        lighting_retrofit_pct=lighting_retrofit_pct,
        flex_ev_pct=flex_ev_pct,
        flex_hvac_pct=flex_hvac_pct,
        flex_industrial_pct=flex_industrial_pct,
        air_quality_floor_pct=air_quality_floor_pct,
        lighting_floor_pct=lighting_floor_pct,
    )
    day = (
        {
            "temp_c": day_temp_c,
            "weather_code": day_weather_code,
            "wind_kmh": day_wind_kmh,
            "precip_mm": day_precip_mm,
            "hourly_temps_c": _parse_hourly(day_hourly_temps_c),
        }
        if day_temp_c is not None
        else None
    )
    result = plan_levers.apply_levers(profiles, levers, day)
    return {
        "source": SOURCE,
        "city": city,
        "buildings": len(profiles),
        "gross_floor_area_m2": sum(p["gross_floor_area_m2"] for p in profiles),
        **result,
    }


@router.get("/building-plan")
def read_building_plan(
    building_id: str = Query(...),
    footprint_m2: float = Query(..., gt=0),
    kind: str | None = Query(None),
    name: str = Query("Building"),
    height_m: float | None = Query(None, gt=0),
    levels: int | None = Query(None, ge=1),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    city: str = Query("Toronto"),
    heat_pump_pct: float = Query(0, ge=0, le=100),
    heat_pump_cop: float = Query(3.0, ge=1, le=6),
    retrofit_pct: float = Query(0, ge=0, le=100),
    retrofit_target_percentile: float = Query(25, ge=0, le=100),
    setpoint_widen_c: float = Query(0, ge=0, le=6),
    lighting_retrofit_pct: float = Query(0, ge=0, le=100),
    day_temp_c: float | None = Query(None),
    day_weather_code: int | None = Query(None),
    day_wind_kmh: float | None = Query(None, ge=0),
    day_precip_mm: float | None = Query(None, ge=0),
    day_hourly_temps_c: str | None = Query(None),
) -> dict[str, Any]:
    """One building, today against the plan.

    The same lever engine the district runs, applied to a single profile, so a
    building's card on the results page agrees with the totals it contributes
    to rather than being computed a second way.
    """
    _require_dataset()
    profile = ewrb_profile.build_profile(
        building_id=building_id,
        name=name,
        kind=kind,
        footprint_m2=footprint_m2,
        height_m=height_m,
        levels=levels,
        lat=lat,
        lon=lon,
        city=city,
    )
    if profile is None:
        raise HTTPException(status_code=404, detail=f"No EWRB cohort matches kind '{kind}'")

    levers = plan_levers.Levers(
        heat_pump_pct=heat_pump_pct,
        heat_pump_cop=heat_pump_cop,
        retrofit_pct=retrofit_pct,
        retrofit_target_percentile=retrofit_target_percentile,
        setpoint_widen_c=setpoint_widen_c,
        lighting_retrofit_pct=lighting_retrofit_pct,
    )
    day = (
        {
            "temp_c": day_temp_c,
            "weather_code": day_weather_code,
            "wind_kmh": day_wind_kmh,
            "precip_mm": day_precip_mm,
            "hourly_temps_c": _parse_hourly(day_hourly_temps_c),
        }
        if day_temp_c is not None
        else None
    )
    result = plan_levers.apply_levers([profile], levers, day)
    return {
        "source": SOURCE,
        "building": {
            "id": profile["building_id"],
            "name": profile["name"],
            "property_type": profile["property_type"],
            "fsa": profile["fsa"],
            "gross_floor_area_m2": profile["gross_floor_area_m2"],
            "site_eui_kwh_m2": profile["intensity"]["site_eui_kwh_m2"],
            "energy_star_score": profile["intensity"]["energy_star_score"],
            "percentile": profile["benchmark"]["site_eui_percentile"],
        },
        **result,
    }


@router.post("/district")
def read_district_rollup(
    buildings: list[dict[str, Any]],
    city: str = Query("Toronto"),
    target_percentile: float = Query(25.0, ge=0, le=100),
) -> dict[str, Any]:
    """Roll a set of viewer buildings up into district totals.

    The Simulate and Plan pages post the massing they are showing and get back
    a coincident demand curve, annual totals and the retrofit gap to reported
    practice. Capped so a full-city payload cannot stall the worker.
    """
    _require_dataset()
    if len(buildings) > 4000:
        raise HTTPException(status_code=413, detail="Send at most 4000 buildings per call")

    profiles: list[dict[str, Any]] = []
    skipped = 0
    for item in buildings:
        footprint = item.get("footprint_m2")
        if not footprint:
            skipped += 1
            continue
        profile = ewrb_profile.build_profile(
            building_id=str(item.get("id") or f"b-{len(profiles)}"),
            name=str(item.get("name") or "Building"),
            kind=item.get("kind"),
            footprint_m2=float(footprint),
            height_m=float(item["h"]) if item.get("h") else None,
            levels=int(item["levels"]) if item.get("levels") else None,
            lat=float(item["lat"]) if item.get("lat") else None,
            lon=float(item["lon"]) if item.get("lon") else None,
            fsa=item.get("fsa"),
            city=city,
        )
        if profile is None:
            skipped += 1
            continue
        profiles.append(profile)

    rollup = ewrb_profile.district_rollup(profiles)
    return {
        "source": SOURCE,
        "city": city,
        "skipped": skipped,
        "peak_hour": ewrb_profile.peak_hour(profiles),
        **rollup,
        "retrofit": ewrb_profile.retrofit_potential(profiles, target_percentile),
    }
