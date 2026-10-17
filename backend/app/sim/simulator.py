"""Deterministic simulator helpers.

Contract: given stored or generated steps, reduce to metrics. The full scenario
engine is still TODO; live UI reads TigerData telemetry via repository.
"""

from datetime import datetime

from app.schemas.models import (
    DispatchAction,
    GridStatus,
    Metrics,
    RunRequest,
    TimeStep,
)

# Declared assumptions (illustrative placeholders, see docs/METRICS.md).
PRICE_PER_MWH = 95.0  # $/MWh
EMISSIONS_FACTOR_T_PER_MWH = 0.38
COMFORT_BOUNDS_C = (20.0, 24.0)
STEP_MINUTES = 15


def simulate(req: RunRequest, actions: list[DispatchAction] | None = None) -> list[TimeStep]:
    """Run the window for a scenario, with or without an optimizer plan."""
    raise NotImplementedError


def compute_metrics(steps: list[TimeStep]) -> Metrics:
    """Reduce a time series to the headline numbers."""
    if not steps:
        return Metrics(
            peak_demand_mw=0,
            energy_cost=0,
            emissions_tco2e=0,
            comfort_violation_minutes=0,
            renewable_share_pct=0,
        )

    hours = STEP_MINUTES / 60.0
    peak = max(float(s.grid_import_mw or 0) for s in steps)
    imported_mwh = sum(float(s.grid_import_mw or 0) * hours for s in steps)
    demand_mwh = sum(float(s.demand_mw or 0) * hours for s in steps)
    renew_mwh = sum(
        min(float(s.solar_mw or 0) + float(s.wind_mw or 0), float(s.demand_mw or 0)) * hours
        for s in steps
    )

    comfort = 0.0
    lo, hi = COMFORT_BOUNDS_C
    for step in steps:
        temp = step.indoor_temp_c
        if temp is None:
            continue
        if temp < lo or temp > hi:
            comfort += STEP_MINUTES

    share = (100.0 * renew_mwh / demand_mwh) if demand_mwh > 0 else 0.0
    return Metrics(
        peak_demand_mw=round(peak, 2),
        energy_cost=round(imported_mwh * PRICE_PER_MWH, 2),
        emissions_tco2e=round(imported_mwh * EMISSIONS_FACTOR_T_PER_MWH, 2),
        comfort_violation_minutes=comfort,
        renewable_share_pct=round(share, 1),
    )


def grid_status(steps: list[TimeStep], at: datetime | None = None) -> GridStatus:
    """Stability / frequency / voltage / reserve at a point in the window."""
    if not steps:
        return GridStatus(stability_pct=0, frequency_hz=60.0, voltage_pu=1.0, reserve_pct=0)

    step = steps[-1]
    if at is not None:
        step = min(steps, key=lambda s: abs((s.t - at).total_seconds()))

    demand = max(float(step.demand_mw or 0), 1.0)
    local = float(step.solar_mw or 0) + float(step.wind_mw or 0) + max(float(step.battery_mw or 0), 0)
    reserve = max(0.0, 100.0 * (1.0 - float(step.grid_import_mw or 0) / demand))
    stress = min(1.0, float(step.grid_import_mw or 0) / demand)
    return GridStatus(
        stability_pct=round(100.0 - stress * 12.0, 1),
        frequency_hz=round(60.0 - stress * 0.08, 3),
        voltage_pu=round(1.0 - stress * 0.04, 3),
        reserve_pct=round(min(40.0, reserve * 0.35 + local / demand * 10.0), 1),
    )
