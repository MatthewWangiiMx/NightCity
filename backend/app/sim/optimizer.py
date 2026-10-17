"""Heuristic, constrained optimizer.

Comfort is a hard constraint: a plan that violates COMFORT_BOUNDS_C is rejected
outright, never traded off against cost or emissions.
"""

from app.schemas.models import DispatchAction, RunRequest, TimeStep


def plan(req: RunRequest, baseline: list[TimeStep]) -> list[DispatchAction]:
    """Choose among battery discharge, EV shifting and HVAC pre-cooling.

    Each returned action carries reason / constraint / assumption so the
    Dispatch Review screen can explain itself without the LLM.
    """
    raise NotImplementedError


def validate(actions: list[DispatchAction], steps: list[TimeStep]) -> list[str]:
    """Return a list of violated constraints; empty means the plan is admissible."""
    raise NotImplementedError
