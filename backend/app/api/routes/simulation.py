from fastapi import APIRouter, HTTPException, Query

from app.db import repository
from app.db.session import get_engine
from app.schemas.models import RunRequest, RunResult, TimeStep

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.get("/live", response_model=RunResult)
def read_live_run(district_id: str = Query("nightcity")) -> RunResult:
    """Serve timesteps derived from real buildings (+ TigerData weather when on)."""
    result = repository.load_live_run(district_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No building stock or telemetry available yet. "
                "Import buildings (scripts/buildings/import_builds.py), "
                "POST /api/weather/ingest, or ensure "
                "frontend/public/data/toronto-massing.json exists."
            ),
        )
    return result


@router.post("/run", response_model=RunResult)
async def run_simulation(req: RunRequest) -> RunResult:
    """Prefer a TigerData-backed live series; fall back to 501 until the sim ships.

    When TigerData has telemetry/weather, scenario selection still returns that
    live window so the UI is no longer stuck on hardcoded fixtures.
    """
    live = repository.load_live_run(req.district_id)
    if live is not None:
        # Keep the requested scenario label on the live TigerData series.
        from app.sim.scenarios import SCENARIOS

        scenario = SCENARIOS.get(req.scenario, live.scenario)
        return live.model_copy(
            update={
                "scenario": scenario,
                "explanation": (
                    f"TigerData live window for scenario “{scenario.label}”. "
                    "Weather from weather_observations; timesteps from telemetry/runs."
                ),
            }
        )

    raise HTTPException(
        status_code=501,
        detail=(
            "simulator not implemented yet and TigerData has no telemetry/weather. "
            "Import data or POST /api/weather/ingest."
        ),
    )


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
def read_telemetry(
    district_id: str,
    limit: int = 500,
    variant: str = "optimized",
) -> list[TimeStep]:
    """Most recent district-level steps, oldest first. Empty when the DB is off."""
    if variant not in ("baseline", "optimized"):
        raise HTTPException(status_code=422, detail="variant must be baseline or optimized")
    return repository.recent_telemetry(district_id, limit=limit, variant=variant)
