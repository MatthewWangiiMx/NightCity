"""Open-Meteo client and response parsing."""

from datetime import datetime

import httpx

from app.config import get_settings
from app.schemas.models import WeatherObservation, WeatherRequest


class WeatherApiError(RuntimeError):
    """The weather provider returned an unusable response."""


def fetch_forecast(request: WeatherRequest) -> list[WeatherObservation]:
    settings = get_settings()
    params = {
        "latitude": request.latitude,
        "longitude": request.longitude,
        "hourly": "temperature_2m,precipitation,wind_speed_10m,weather_code",
        "forecast_days": request.forecast_days,
        "past_days": request.past_days,
        "timezone": "UTC",
    }

    try:
        response = httpx.get(settings.open_meteo_forecast_url, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise WeatherApiError("Open-Meteo could not be reached or returned invalid JSON") from exc

    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        raise WeatherApiError("Open-Meteo response did not contain hourly data")

    times = hourly.get("time")
    temperatures = hourly.get("temperature_2m")
    precipitation = hourly.get("precipitation")
    wind_speed = hourly.get("wind_speed_10m")
    weather_codes = hourly.get("weather_code")
    series = (times, temperatures, precipitation, wind_speed, weather_codes)
    if not all(isinstance(values, list) for values in series):
        raise WeatherApiError("Open-Meteo hourly data is incomplete")
    if len({len(values) for values in series}) != 1:
        raise WeatherApiError("Open-Meteo hourly data has inconsistent lengths")

    observations: list[WeatherObservation] = []
    for values in zip(*series):
        try:
            observations.append(
                WeatherObservation(
                    observation_time=datetime.fromisoformat(str(values[0]).replace("Z", "+00:00")),
                    latitude=request.latitude,
                    longitude=request.longitude,
                    temperature_2m_c=values[1],
                    precipitation_mm=values[2],
                    wind_speed_10m_kmh=values[3],
                    weather_code=values[4],
                )
            )
        except (TypeError, ValueError) as exc:
            raise WeatherApiError("Open-Meteo returned an invalid hourly observation") from exc
    return observations
