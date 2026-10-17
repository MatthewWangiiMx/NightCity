from fastapi import APIRouter, HTTPException, Query

from app.db import repository
from app.db.session import get_engine
from app.schemas.models import WeatherIngestResponse, WeatherObservation, WeatherRequest
from app.weather import WeatherApiError, fetch_forecast

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("/observations", response_model=list[WeatherObservation])
def read_weather_observations(
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
    limit: int = Query(168, ge=1, le=2000),
) -> list[WeatherObservation]:
    """Hourly weather rows from TigerData `weather_observations`."""
    if get_engine() is None:
        raise HTTPException(
            status_code=503,
            detail="Database is disabled; set USE_DATABASE=true and TIGERDATA_URL",
        )
    rows = repository.list_weather_observations(
        latitude=latitude,
        longitude=longitude,
        limit=limit,
    )
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No weather rows in TigerData. POST /api/weather/ingest first.",
        )
    return rows


@router.post("/ingest", response_model=WeatherIngestResponse)
def ingest_weather(request: WeatherRequest) -> WeatherIngestResponse:
    """Fetch an Open-Meteo forecast and persist its hourly observations."""
    if get_engine() is None:
        raise HTTPException(
            status_code=503,
            detail="Database is disabled; set USE_DATABASE=true and TIGERDATA_URL before ingesting weather",
        )
    try:
        observations = fetch_forecast(request)
        saved = repository.save_weather_observations(observations)
    except WeatherApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return WeatherIngestResponse(
        observations_saved=saved,
        latitude=request.latitude,
        longitude=request.longitude,
    )
