"""Optional LLM layer.

It explains a plan that the simulator already produced. It never invents a
number and it is never on the critical path: if it fails, callers fall back to
the deterministic `reason` text on each DispatchAction.
"""

from app.config import get_settings
from app.schemas.models import DispatchAction, Metrics

SYSTEM_PROMPT = (
    "You explain an energy dispatch plan for a simulated district. "
    "Use only the numbers provided. Never estimate, extrapolate, or invent "
    "values. State that results are simulated."
)


async def explain(
    actions: list[DispatchAction],
    baseline: Metrics,
    optimized: Metrics,
) -> str | None:
    settings = get_settings()
    if not settings.enable_llm or not settings.anthropic_api_key:
        return None
    # TODO: anthropic.AsyncAnthropic(...).messages.create(model=settings.llm_model, ...)
    # Wrap in try/except and return None on any failure (graceful fallback).
    raise NotImplementedError
