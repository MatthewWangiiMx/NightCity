-- Logical structures over 3D Massing parts.
--
-- Toronto's 3D Massing publishes a building complex as several polygons -- a
-- podium plus the towers nested inside it -- and carries no structure or
-- building identifier to tie them together (the shapefile has nine fields, all
-- heights and sources). Treating each part as a building is wrong in two
-- measurable ways: it hands one complex several independent EWRB cohort draws,
-- and it double-counts floor area where a tower sits inside a podium (15% of
-- ground area on a downtown block).
--
-- `structure_id` groups parts that genuinely occupy the same ground. It is the
-- lowest `buildings.id` in the group, so it is stable across reruns as long as
-- the ids are. Parts that only *touch* are left separate: a shared wall is a
-- party wall between two buildings, not one building.
--
-- `structure_footprint_m2` is the structure's *union* ground area, and
-- `is_duplicate` marks parts whose footprint repeats one already counted. Both
-- are materialised rather than computed per request: ST_Union per structure
-- over a downtown query is far too slow to sit in the request path.
--
-- All three are populated by scripts/cluster_structures.py. NULL structure_id
-- means "not yet clustered", and every read path falls back to `id`, so the
-- column is optional and the app runs without it.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS structure_id BIGINT;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS structure_footprint_m2 DOUBLE PRECISION;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS buildings_structure_idx ON buildings (structure_id);
