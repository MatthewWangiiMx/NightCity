"""Open-Meteo client and response parsing."""

from collections import Counter
from datetime import datetime

import httpx

from app.config import get_settings
from app.schemas.models import (
    DailyWeatherForecast,
    DailyWeatherForecastResponse,
    WeatherObservation,
    WeatherRequest,
)


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


def daily_forecast(
    request: WeatherRequest,
    observations: list[WeatherObservation] | None = None,
) -> DailyWeatherForecastResponse:
    """Aggregate Open-Meteo hourly observations for the plan page.

    The demand factor is intentionally calculated here, beside the weather
    provider integration, so the frontend only presents backend-derived data.
    """
    observations = observations if observations is not None else fetch_forecast(request)
    by_date: dict[str, list[WeatherObservation]] = {}
    for observation in observations:
        by_date.setdefault(observation.observation_time.date().isoformat(), []).append(observation)

    days: list[DailyWeatherForecast] = []
    for date, values in sorted(by_date.items()):
        temperatures = [v.temperature_2m_c for v in values if v.temperature_2m_c is not None]
        precipitation = [v.precipitation_mm or 0.0 for v in values]
        wind = [v.wind_speed_10m_kmh or 0.0 for v in values]
        codes = [v.weather_code for v in values if v.weather_code is not None]
        average_temp = sum(temperatures) / len(temperatures) if temperatures else 15.0
        heating = max(0.0, 14.0 - average_temp) * 0.035
        cooling = max(0.0, average_temp - 22.0) * 0.045
        weather_factor = round(1.0 + heating + cooling, 3)

        # Hour-of-day temperature. A forecast day can arrive short (the first
        # day starts mid-afternoon) so missing hours fall back to the day mean
        # rather than to zero, which would read as a hard freeze.
        hourly = [None] * 24  # type: list[float | None]
        for value in values:
            if value.temperature_2m_c is not None:
                hourly[value.observation_time.hour] = value.temperature_2m_c
        filled = [h if h is not None else average_temp for h in hourly]

        days.append(
            DailyWeatherForecast(
                hourly_temps_c=[round(t, 2) for t in filled],
                date=date,
                weather_code=Counter(codes).most_common(1)[0][0] if codes else 0,
                temp_max_c=max(temperatures) if temperatures else 0.0,
                temp_min_c=min(temperatures) if temperatures else 0.0,
                precip_mm=sum(precipitation),
                wind_max_kmh=max(wind) if wind else 0.0,
                weather_demand_factor=weather_factor,
            )
        )

    return DailyWeatherForecastResponse(timezone="UTC", days=days)


# --- Daily refresh against TigerData --------------------------------------
# Open-Meteo publishes a new forecast a few times a day and rate-limits free
# use. Nothing here needs fresher than daily, so the provider is called at most
# once per location per day and every other request is served from TigerData.
FORECAST_REFRESH_HOURS = 24


def cached_daily_forecast(request: WeatherRequest) -> DailyWeatherForecastResponse:
    """Daily forecast, refreshed from Open-Meteo at most once a day.

    Order of preference:

    1. TigerData, when what we hold was written inside the refresh window
    2. Open-Meteo, saved to TigerData on the way through
    3. TigerData again, stale, if the provider is unreachable

    Falling back to stale data in (3) is deliberate. A day-old forecast is a
    far better answer than an error page, and the response says which it is, so
    nothing downstream has to guess.
    """
    # Imported here: app.db pulls in SQLAlchemy and the engine, and this module
    # is also used in paths that run without a database at all.
    from app.db import repository
    from app.db.session import get_engine

    if get_engine() is None:
        return daily_forecast(request)

    last_at = repository.weather_last_ingest_at(request.latitude, request.longitude)
    fresh = False
    if last_at is not None:
        age = datetime.now(last_at.tzinfo) - last_at
        fresh = age.total_seconds() < FORECAST_REFRESH_HOURS * 3600

    if fresh:
        rows = repository.list_weather_forecast(
            request.latitude, request.longitude, days=request.forecast_days
        )
        if rows:
            response = daily_forecast(request, observations=rows)
            response.source = "tigerdata-cache"
            return response

    try:
        observations = fetch_forecast(request)
        repository.save_weather_observations(observations)
        response = daily_forecast(request, observations=observations)
        response.source = "open-meteo"
        return response
    except (WeatherApiError, httpx.HTTPError, RuntimeError):
        # Provider unreachable: serve whatever is stored rather than failing.
        rows = repository.list_weather_forecast(
            request.latitude, request.longitude, days=request.forecast_days
        )
        if not rows:
            raise
        response = daily_forecast(request, observations=rows)
        response.source = "tigerdata-stale"
        return response
