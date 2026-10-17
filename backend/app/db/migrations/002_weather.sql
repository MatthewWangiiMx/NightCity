-- Hourly weather data fetched from Open-Meteo.
-- Apply after 001_init.sql:
-- psql "$TIGERDATA_URL" -f app/db/migrations/002_weather.sql

CREATE TABLE IF NOT EXISTS weather_observations (
    observation_time     TIMESTAMPTZ NOT NULL,
    latitude             DOUBLE PRECISION NOT NULL,
    longitude            DOUBLE PRECISION NOT NULL,
    temperature_2m_c     DOUBLE PRECISION,
    precipitation_mm     DOUBLE PRECISION,
    wind_speed_10m_kmh   DOUBLE PRECISION,
    weather_code         INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (observation_time, latitude, longitude)
);

SELECT create_hypertable(
    'weather_observations',
    'observation_time',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS weather_location_time_idx
    ON weather_observations (latitude, longitude, observation_time DESC);
