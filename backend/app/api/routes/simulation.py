from fastapi import APIRouter, HTTPException

from app.db import repository
from app.schemas.models import RunRequest, RunResult, TimeStep

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/run", response_model=RunResult)
async def run_simulation(req: RunRequest) -> RunResult:
    """Baseline + optimized on identical inputs, plus the plan that explains it.

    TODO: baseline = simulate(req); actions = plan(req, baseline);
    optimized = simulate(req, actions); then `repository.save_run(result)`
    before returning — that one call is what persists the run to TigerData.
    """
    raise HTTPException(status_code=501, detail="simulator not implemented yet")


@router.get("/runs/{run_id}", response_model=RunResult)
def read_run(run_id: str) -> RunResult:
    """Replay a stored run out of TigerData."""
    result = repository.load_run(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"no stored run {run_id!r}")
    return result


@router.get("/runs/{run_id}/playback", response_model=list[TimeStep])
def read_playback(run_id: str, variant: str = "optimized") -> list[TimeStep]:
    """Time series for the timeline scrubber under the map."""
    if variant not in ("baseline", "optimized"):
        raise HTTPException(status_code=422, detail="variant must be baseline or optimized")
    result = repository.load_run(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"no stored run {run_id!r}")
    return result.baseline if variant == "baseline" else result.optimized


@router.get("/telemetry/{district_id}", response_model=list[TimeStep])
def read_telemetry(district_id: str, limit: int = 500) -> list[TimeStep]:
    """Most recent district-level steps, oldest first. Empty when the DB is off."""
    return repository.recent_telemetry(district_id, limit=limit)
