-- A stable EWRB cohort key per structure.
--
-- `app/sim/ewrb_profile.py` places a building in its reported cohort by hashing
-- a key string, so that key decides which real filed property the building is
-- shown as. Until now the key was built from `structure_id`, which is the
-- lowest `buildings.id` in the group -- and `id` is BIGSERIAL. Re-importing the
-- massing reassigns every id, so the same building draws a different comparable
-- afterwards: on the last re-import the CN Tower moved from 444.8 to 115.2
-- kWh/m2*yr, rank 25 of its 26-row cohort to rank 1. Nothing was wrong with
-- either figure; the key had simply changed.
--
-- `structure_eui_key` is derived from the structure's geometry instead -- the
-- centroid of its tallest part, to four decimal places -- so it survives a
-- re-import, a re-cluster and a move to another service. The geometry is the
-- building; the serial is an accident of insert order.
--
-- It is stored rather than computed per request so that every read path, and
-- the generated browser artifact, carry one identical string. Deriving it
-- independently in SQL and again in TypeScript would reintroduce the same
-- divergence one rounding digit lower down.
--
-- Populated by scripts/cluster_structures.py. NULL means "not yet clustered"
-- and every read path falls back to the old structure_id key, so this column
-- is optional and the app runs without it.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS structure_eui_key TEXT;

CREATE INDEX IF NOT EXISTS buildings_structure_eui_key_idx
    ON buildings (structure_eui_key);
