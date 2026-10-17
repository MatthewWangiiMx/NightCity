from fastapi import APIRouter, HTTPException

from app.schemas.models import RunRequest, RunResult, TimeStep

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/run", response_model=RunResult)
async def run_simulation(req: RunRequest) -> RunResult:
    """Baseline + optimized on identical inputs, plus the plan that explains it.

    TODO: baseline = simulate(req); actions = plan(req, baseline);
    optimized = simulate(req, actions); persist via repository.save_run().
    """
    raise HTTPException(status_code=501, detail="simulator not implemented yet")


@router.get("/runs/{run_id}", response_model=RunResult)
def read_run(run_id: str) -> RunResult:
    raise HTTPException(status_code=501, detail="run storage not implemented yet")


@router.get("/runs/{run_id}/playback", response_model=list[TimeStep])
def read_playback(run_id: str, variant: str = "optimized") -> list[TimeStep]:
    """Time series for the timeline scrubber under the map."""
    raise HTTPException(status_code=501, detail="playback not implemented yet")
