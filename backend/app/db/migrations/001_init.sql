-- TigerData / TimescaleDB schema for NightCity.
-- Apply with:  psql "$TIGERDATA_URL" -f app/db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS districts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    district_id  TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- solar | wind | battery | ev_charging | building | grid_tie
    capacity_mw  DOUBLE PRECISION NOT NULL,
    x            DOUBLE PRECISION NOT NULL,
    y            DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    district_id   TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    scenario      TEXT NOT NULL,
    optimized     BOOLEAN NOT NULL,
    params        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- One run holds both variants, so both metric sets are stored side by side.
    baseline_metrics   JSONB,            -- peak, cost, emissions, comfort, renewable share
    optimized_metrics  JSONB,
    grid_status        JSONB,            -- stability, frequency, voltage, reserve
    explanation        TEXT,             -- LLM narration, if any; never a source of numbers
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Time series: one row per asset per step, for both the baseline and the plan.
CREATE TABLE IF NOT EXISTS telemetry (
    t               TIMESTAMPTZ NOT NULL,
    run_id          TEXT NOT NULL,
    district_id     TEXT NOT NULL,
    asset_id        TEXT,
    variant         TEXT NOT NULL,       -- 'baseline' | 'optimized'
    demand_mw       DOUBLE PRECISION,
    solar_mw        DOUBLE PRECISION,
    wind_mw         DOUBLE PRECISION,
    battery_mw      DOUBLE PRECISION,
    battery_soc     DOUBLE PRECISION,
    grid_import_mw  DOUBLE PRECISION,
    indoor_temp_c   DOUBLE PRECISION
);

SELECT create_hypertable('telemetry', 't', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS telemetry_run_idx ON telemetry (run_id, variant, t DESC);

-- Dispatch actions chosen by the optimizer, kept for the Dispatch Review screen.
CREATE TABLE IF NOT EXISTS dispatch_actions (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    title        TEXT NOT NULL,
    detail       TEXT,
    target_asset TEXT,
    delta_mw     DOUBLE PRECISION,
    reason       TEXT,
    constraint_  TEXT,
    assumption   TEXT
);
