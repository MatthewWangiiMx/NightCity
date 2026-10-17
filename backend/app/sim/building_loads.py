"""Derive TimeStep demand from real building massing + weather.

Toronto 3D Massing / TigerData `buildings` have no metered loads, so each
footprint gets a deterministic W/m² model scaled by height, floors, and outdoor
temperature. District TimeSteps are the sum across those buildings.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.buildings_massing import (
    LAT_MAX,
    LAT_MIN,
    LON_MAX,
    LON_MIN,
    TYPICAL_FLOOR_M,
    construction_from_row,
)
from app.schemas.models import (
    Asset,
    AssetKind,
    District,
    EnergyFlow,
    TimeStep,
    WeatherObservation,
)
from app.sim.simulator import STEP_MINUTES

ROOT = Path(__file__).resolve().parents[3]
MASSING_CACHE = ROOT / "frontend" / "public" / "data" / "toronto-massing.json"


@dataclass(frozen=True)
class BuildingProfile:
    id: str
    height_m: float
    levels: int
    footprint_m2: float
    lon: float
    lat: float
    name: str


def _ring_area(ring: list[list[float]]) -> float:
    if len(ring) < 4:
        return 0.0
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(a) * 0.5


def profiles_from_massing_cache(limit: int = 1200) -> list[BuildingProfile]:
    """Offline fallback: same downtown massing the Explore City viewer uses."""
    if not MASSING_CACHE.is_file():
        return []
    payload = json.loads(MASSING_CACHE.read_text(encoding="utf-8"))
    origin = payload.get("origin") or {}
    origin_lat = float(origin.get("lat", 43.6426))
    origin_lon = float(origin.get("lon", -79.3871))
    out: list[BuildingProfile] = []
    for i, b in enumerate(payload.get("buildings") or []):
        rings = b.get("rings") or []
        if not rings:
            continue
        area = _ring_area(rings[0])
        if area < 40:
            continue
        h = float(b.get("h") or 0)
        if h < 10:
            continue
        levels = int(b.get("levels") or max(1, round(h / TYPICAL_FLOOR_M)))
        # rings are local metres; invert to approximate lon/lat for map placement
        body = rings[0]
        cx = sum(p[0] for p in body[:-1]) / max(1, len(body) - 1)
        cz = sum(p[1] for p in body[:-1]) / max(1, len(body) - 1)
        lon = origin_lon + cx / (111_320.0 * math.cos(math.radians(origin_lat)))
        lat = origin_lat - cz / 110_540.0
        bid = str(b["id"]) if b.get("id") is not None else f"massing-{i}"
        out.append(
            BuildingProfile(
                id=bid,
                height_m=h,
                levels=levels,
                footprint_m2=area,
                lon=lon,
                lat=lat,
                name=f"Building · {round(h)}m",
            )
        )
        if len(out) >= limit:
            break
    return out


def profiles_from_tiger_rows(rows: list[dict], limit: int = 1200) -> list[BuildingProfile]:
    out: list[BuildingProfile] = []
    for row in rows:
        props = row.get("properties") or {}
        if isinstance(props, str):
            props = json.loads(props)
        cons = construction_from_row(
            height_m=row.get("height_m"),
            levels=row.get("levels"),
            properties=props,
        )
        h = float(cons["h"])
        if h < 10:
            continue
        footprint = row.get("footprint_m2")
        if footprint is None:
            continue
        footprint = float(footprint)
        if footprint < 40:
            continue
        lon = row.get("lon")
        lat = row.get("lat")
        if lon is None or lat is None:
            continue
        out.append(
            BuildingProfile(
                id=str(row["id"]),
                height_m=h,
                levels=int(cons["levels"]),
                footprint_m2=footprint,
                lon=float(lon),
                lat=float(lat),
                name=f"Building {row['id']} · {round(h)}m",
            )
        )
        if len(out) >= limit:
            break
    return out


def _intensity(height_m: float) -> float:
    if height_m >= 160:
        return 1.2
    if height_m >= 80:
        return 1.1
    if height_m >= 40:
        return 0.85
    return 0.75


def building_demand_mw(
    profile: BuildingProfile,
    *,
    outdoor_c: float,
    hour: float,
) -> float:
    """Instantaneous building electric demand (MW) at a clock hour."""
    gfa = max(40.0, profile.footprint_m2) * max(1, profile.levels)
    w_per_m2 = 48.0 * _intensity(profile.height_m)
    # Mild diurnal occupancy (office-ish daytime peak, residential evening bump)
    tod = 0.62 + 0.28 * math.sin((hour - 8.0) / 24.0 * 2 * math.pi) ** 2
    if 17.0 <= hour <= 21.5:
        tod += 0.12
    # HVAC response to outdoor temperature
    cooling = max(0.0, outdoor_c - 22.0) * 0.045
    heating = max(0.0, 14.0 - outdoor_c) * 0.035
    hvac = 1.0 + cooling + heating
    kw = (gfa * w_per_m2 / 1000.0) * tod * hvac
    return kw / 1000.0  # MW


def _weather_at(weather: list[WeatherObservation], t: datetime) -> WeatherObservation | None:
    if not weather:
        return None
    return min(weather, key=lambda w: abs((w.observation_time - t).total_seconds()))


def _synthetic_weather_window(start: datetime, steps: int) -> list[WeatherObservation]:
    """Toronto-ish October curve when TigerData weather is empty."""
    out: list[WeatherObservation] = []
    for i in range(steps):
        t = start + timedelta(minutes=STEP_MINUTES * i)
        hour = t.hour + t.minute / 60.0
        temp = 12.0 + 6.0 * math.sin((hour - 14.0) / 24.0 * 2 * math.pi)
        wind = 14.0 + 6.0 * math.sin(hour / 3.0)
        out.append(
            WeatherObservation(
                observation_time=t,
                latitude=43.6532,
                longitude=-79.3832,
                temperature_2m_c=round(temp, 2),
                precipitation_mm=0.0,
                wind_speed_10m_kmh=round(wind, 2),
                weather_code=2,
            )
        )
    return out


def synthesize_steps_from_buildings(
    profiles: list[BuildingProfile],
    weather: list[WeatherObservation],
    *,
    hours: float = 5.0,
    optimized: bool = False,
) -> list[TimeStep]:
    """District TimeSteps whose demand_mw is the sum of real building loads."""
    if not profiles:
        return []

    steps_n = int(hours * 60 / STEP_MINUTES) + 1
    if weather:
        start = min(w.observation_time for w in weather)
        # Prefer an evening window inside the weather series when available.
        evening = [w for w in weather if 16 <= w.observation_time.hour <= 21]
        if evening:
            start = min(w.observation_time for w in evening)
    else:
        start = datetime(2026, 10, 16, 16, 0, tzinfo=timezone.utc)
        weather = _synthetic_weather_window(start, steps_n)

    # District renewables / storage scaled to the building stock peak.
    sample_outdoor = 15.0
    stock_peak = sum(
        building_demand_mw(p, outdoor_c=sample_outdoor, hour=19.0) for p in profiles
    )
    solar_cap = max(40.0, stock_peak * 0.35)
    wind_cap = max(25.0, stock_peak * 0.22)
    battery_cap = max(20.0, stock_peak * 0.12)

    out: list[TimeStep] = []
    for i in range(steps_n):
        t = start + timedelta(minutes=STEP_MINUTES * i)
        w = _weather_at(weather, t)
        outdoor = float(w.temperature_2m_c) if w and w.temperature_2m_c is not None else 15.0
        wind_speed = float(w.wind_speed_10m_kmh) if w and w.wind_speed_10m_kmh is not None else 12.0
        hour = t.hour + t.minute / 60.0

        demand = sum(
            building_demand_mw(p, outdoor_c=outdoor, hour=hour) for p in profiles
        )

        # Clear-sky solar proxy from solar elevation angle (rough).
        elev = max(0.0, math.sin(max(0.0, (hour - 6.5) / 12.0) * math.pi))
        solar = solar_cap * elev * elev
        wind = wind_cap * min(1.2, wind_speed / 18.0)

        # Event-ish solar cut after 18:45 in the window for baseline stress.
        event = hour >= 18.75
        if event:
            solar *= 0.65

        battery = 0.0
        soc = 0.8
        indoor = round(20.8 + (outdoor - 15.0) * 0.16, 2)

        if optimized:
            if event:
                battery = min(battery_cap * 0.7, max(0.0, demand * 0.08))
                demand *= 0.94  # flexible load shed / precool recovery
                soc = max(0.22, 0.8 - (hour - 18.75) * 0.12)
                indoor = round(indoor - 0.4, 2)
            elif hour < 18.0:
                battery = -battery_cap * 0.25  # charge
                demand *= 1.03  # precool
                indoor = round(indoor - 0.7, 2)

        grid = max(0.0, demand - solar - wind - max(battery, 0.0))
        out.append(
            TimeStep(
                t=t,
                demand_mw=round(demand, 3),
                solar_mw=round(solar, 3),
                wind_mw=round(wind, 3),
                battery_mw=round(battery, 3),
                battery_soc=round(soc, 3),
                grid_import_mw=round(grid, 3),
                indoor_temp_c=indoor,
                building_id=None,  # district aggregate
            )
        )
    return out


def district_from_buildings(
    profiles: list[BuildingProfile],
    district_id: str = "nightcity",
    *,
    featured: int = 14,
) -> District:
    """Map assets: grid resources + top buildings by height from real massing."""
    lon_span = max(LON_MAX - LON_MIN, 1e-6)
    lat_span = max(LAT_MAX - LAT_MIN, 1e-6)

    def xy(lon: float, lat: float) -> tuple[float, float]:
        x = (lon - LON_MIN) / lon_span
        y = 1.0 - (lat - LAT_MIN) / lat_span
        return (min(0.95, max(0.05, x)), min(0.9, max(0.08, y)))

    ranked = sorted(profiles, key=lambda p: p.height_m, reverse=True)
    top = ranked[:featured]
    other = ranked[featured:]
    other_peak = sum(building_demand_mw(p, outdoor_c=18.0, hour=19.0) for p in other)

    assets: list[Asset] = [
        Asset(
            id="solar_farm",
            name="Solar Farm",
            kind=AssetKind.SOLAR,
            capacity_mw=round(max(40.0, sum(p.height_m for p in profiles) * 0.02), 1),
            x=0.18,
            y=0.16,
        ),
        Asset(
            id="wind",
            name="Wind Turbines",
            kind=AssetKind.WIND,
            capacity_mw=round(max(25.0, len(profiles) * 0.04), 1),
            x=0.82,
            y=0.14,
        ),
    ]

    for p in top:
        x, y = xy(p.lon, p.lat)
        peak = building_demand_mw(p, outdoor_c=18.0, hour=19.0)
        assets.append(
            Asset(
                id=f"bldg-{p.id}",
                name=p.name,
                kind=AssetKind.BUILDING,
                capacity_mw=round(max(0.2, peak * 1.35), 3),
                x=x,
                y=y,
            )
        )

    if other:
        assets.append(
            Asset(
                id="bldg-other",
                name=f"Other downtown ({len(other)} buildings)",
                kind=AssetKind.BUILDING,
                capacity_mw=round(max(1.0, other_peak * 1.35), 2),
                x=0.5,
                y=0.48,
            )
        )

    assets.extend(
        [
            Asset(
                id="battery",
                name="Battery Storage",
                kind=AssetKind.BATTERY,
                capacity_mw=round(max(20.0, other_peak * 0.15 + 10), 1),
                x=0.86,
                y=0.56,
            ),
            Asset(
                id="ev",
                name="EV Charging",
                kind=AssetKind.EV_CHARGING,
                capacity_mw=42,
                x=0.16,
                y=0.7,
            ),
            Asset(
                id="grid",
                name="Grid Tie",
                kind=AssetKind.GRID_TIE,
                capacity_mw=500,
                x=0.5,
                y=0.92,
            ),
        ]
    )

    building_ids = [a.id for a in assets if a.kind == AssetKind.BUILDING]
    hub = building_ids[0] if building_ids else "bldg-other"
    flows = [
        EnergyFlow(id="f1", from_asset="solar_farm", to_asset=hub, mw=30),
        EnergyFlow(id="f2", from_asset="wind", to_asset=hub, mw=20),
        EnergyFlow(id="f3", from_asset="battery", to_asset=hub, mw=15),
        EnergyFlow(id="f4", from_asset="grid", to_asset=hub, mw=80),
    ]

    return District(
        id=district_id,
        name="Night City District",
        assets=assets,
        flows=flows,
    )
