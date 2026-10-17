from fastapi import APIRouter, HTTPException

from app.db.repository import save_weather_observations
from app.db.session import get_engine
from app.schemas.models import WeatherIngestResponse, WeatherRequest
from app.weather import WeatherApiError, fetch_forecast

router = APIRouter(prefix="/weather", tags=["weather"])


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
        saved = save_weather_observations(observations)
    except WeatherApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return WeatherIngestResponse(
        observations_saved=saved,
        latitude=request.latitude,
        longitude=request.longitude,
    )
