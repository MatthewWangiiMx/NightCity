-- The Night City district and its six assets.
--
-- These rows existed only in the live database until now: nothing in the repo
-- created them, so a fresh service came up with empty `districts` and `assets`
-- and `/api/district/{id}` had nothing to return. They mirror the in-code
-- district in app/sim/district.py, and the two are expected to agree -- the
-- table is what the API serves when USE_DATABASE=true.
--
-- Apply after 001_init.sql. Idempotent: re-running updates the rows in place
-- rather than failing on the primary keys.

INSERT INTO districts (id, name) VALUES
    ('nightcity', 'Night City District')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- capacity_mw is the asset's rating; x / y are its position on the district
-- map, as fractions of the canvas rather than coordinates.
INSERT INTO assets (id, district_id, name, kind, capacity_mw, x, y) VALUES
    ('solar_farm', 'nightcity', 'Solar Farm',     'solar',       120.0, 0.22, 0.18),
    ('wind',       'nightcity', 'Wind Turbines',  'wind',         85.0, 0.78, 0.12),
    ('city',       'nightcity', 'City District',  'building',    320.0, 0.50, 0.40),
    ('battery',    'nightcity', 'Battery Storage','battery',      60.0, 0.80, 0.52),
    ('ev',         'nightcity', 'EV Charging',    'ev_charging',  42.0, 0.20, 0.62),
    ('grid',       'nightcity', 'Grid Tie',       'grid_tie',    500.0, 0.50, 0.92)
ON CONFLICT (id) DO UPDATE SET
    district_id = EXCLUDED.district_id,
    name        = EXCLUDED.name,
    kind        = EXCLUDED.kind,
    capacity_mw = EXCLUDED.capacity_mw,
    x           = EXCLUDED.x,
    y           = EXCLUDED.y;
