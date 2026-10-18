"""Wire contracts shared with the frontend (mirrored in frontend/src/api/types.ts).

Skeleton: fields are the shape we intend to send; values are produced by the
deterministic simulator, never by the LLM.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class AssetKind(str, Enum):
    SOLAR = "solar"
    WIND = "wind"
    BATTERY = "battery"
    EV_CHARGING = "ev_charging"
    BUILDING = "building"
    GRID_TIE = "grid_tie"


class ScenarioKind(str, Enum):
    SOLAR_DROP = "solar_drop"
    HEAT_WAVE = "heat_wave"
    EV_SURGE = "ev_surge"
    BATTERY_OUTAGE = "battery_outage"
    STORM = "storm"
    BASELINE = "baseline"


class ActionKind(str, Enum):
    BATTERY_DISCHARGE = "battery_discharge"
    SHIFT_EV_CHARGING = "shift_ev_charging"
    PRECOOL_BUILDING = "precool_building"
    CURTAIL_FLEXIBLE_LOAD = "curtail_flexible_load"


# --- District / assets -------------------------------------------------------

class Asset(BaseModel):
    id: str
    name: str
    kind: AssetKind
    capacity_mw: float
    # Position on the isometric map, in normalized 0..1 scene coordinates.
    x: float
    y: float


class EnergyFlow(BaseModel):
    """One animated path on the district map."""
    id: str
    from_asset: str
    to_asset: str
    mw: float


class District(BaseModel):
    id: str
    name: str
    assets: list[Asset]
    flows: list[EnergyFlow] = Field(default_factory=list)


# --- Simulation --------------------------------------------------------------

class TimeStep(BaseModel):
    t: datetime
    demand_mw: float
    solar_mw: float
    wind_mw: float
    battery_mw: float          # + discharge, - charge
    battery_soc: float         # 0..1
    grid_import_mw: float
    indoor_temp_c: float | None = None
    # When set, this row is a single TigerData / massing building.
    # District aggregates leave this null; demand_mw is then the sum of buildings.
    building_id: str | None = None


class GridStatus(BaseModel):
    stability_pct: float
    frequency_hz: float
    voltage_pu: float
    reserve_pct: float


class Metrics(BaseModel):
    """Every metric is defined by an explicit equation; see docs/METRICS.md."""
    peak_demand_mw: float
    energy_cost: float
    emissions_tco2e: float
    comfort_violation_minutes: float
    renewable_share_pct: float


class DispatchAction(BaseModel):
    id: str
    kind: ActionKind
    title: str
    detail: str
    target_asset: str
    delta_mw: float
    reason: str                # why the optimizer chose it
    constraint: str            # the limit it respected
    assumption: str            # label for anything synthetic


class Scenario(BaseModel):
    id: str
    kind: ScenarioKind
    label: str
    description: str
    event_time: datetime | None = None


class RunRequest(BaseModel):
    scenario: ScenarioKind = ScenarioKind.SOLAR_DROP
    district_id: str = "nightcity"
    optimize: bool = True
    # Free-form knobs from the What-if Lab (severity, duration, etc.)
    params: dict[str, float] = Field(default_factory=dict)


class RunResult(BaseModel):
    run_id: str
    scenario: Scenario
    district: District
    baseline: list[TimeStep]
    optimized: list[TimeStep]
    baseline_metrics: Metrics
    optimized_metrics: Metrics
    grid_status: GridStatus
    actions: list[DispatchAction]
    explanation: str | None = None     # LLM text, optional and non-authoritative
    is_simulated: bool = True          # always true: this is a digital twin
    # TigerData weather window aligned to the run (may be empty).
    weather: list[WeatherObservation] = Field(default_factory=list)
    source: str = "demo"  # demo | tigerdata-run | tigerdata-telemetry


class WeatherRequest(BaseModel):
    latitude: float = Field(43.6532, ge=-90, le=90)
    longitude: float = Field(-79.3832, ge=-180, le=180)
    forecast_days: int = Field(3, ge=1, le=16)
    past_days: int = Field(0, ge=0, le=92)


class WeatherObservation(BaseModel):
    observation_time: datetime
    latitude: float
    longitude: float
    temperature_2m_c: float | None = None
    precipitation_mm: float | None = None
    wind_speed_10m_kmh: float | None = None
    weather_code: int | None = None


class WeatherIngestResponse(BaseModel):
    source: str = "open-meteo"
    observations_saved: int
    latitude: float
    longitude: float


class DailyWeatherForecast(BaseModel):
    date: str
    weather_code: int
    temp_max_c: float
    temp_min_c: float
    precip_mm: float
    wind_max_kmh: float
    weather_demand_factor: float
    # 24 hourly temperatures, index = hour of day. Open-Meteo already returns
    # these and the daily aggregate used to discard them; the plan's load curve
    # needs them, because heating demand follows temperature hour by hour and a
    # daily mean cannot say when the cold actually falls.
    hourly_temps_c: list[float] = []


class DailyWeatherForecastResponse(BaseModel):
    timezone: str
    days: list[DailyWeatherForecast]
    source: str = "open-meteo"
