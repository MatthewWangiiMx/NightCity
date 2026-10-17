"""Deterministic simulator.

Contract: given a scenario and a plan, produce a time series. No randomness
without a seed, no LLM involvement. Every number the UI shows originates here.
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
PRICE_PER_MWH = 95.0          # $/MWh
EMISSIONS_FACTOR_T_PER_MWH = 0.38
COMFORT_BOUNDS_C = (20.0, 24.0)
STEP_MINUTES = 15


def simulate(req: RunRequest, actions: list[DispatchAction] | None = None) -> list[TimeStep]:
    """Run the window for a scenario, with or without an optimizer plan.

    TODO: demand curve + solar/wind profile + battery state machine +
    EV flexibility + building thermal model.
    """
    raise NotImplementedError


def compute_metrics(steps: list[TimeStep]) -> Metrics:
    """Reduce a time series to the headline numbers.

    peak_demand_mw   = max(grid_import_mw)
    energy_cost      = sum(grid_import_mw * hours) * PRICE_PER_MWH
    emissions_tco2e  = sum(grid_import_mw * hours) * EMISSIONS_FACTOR_T_PER_MWH
    comfort_minutes  = minutes with indoor_temp outside COMFORT_BOUNDS_C
    renewable_share  = renewable used locally / total demand
    """
    raise NotImplementedError


def grid_status(steps: list[TimeStep], at: datetime | None = None) -> GridStatus:
    """Stability / frequency / voltage / reserve at a point in the window."""
    raise NotImplementedError
