"""Group 3D Massing parts into logical structures.

Run from ``backend`` with ``TIGERDATA_URL`` set:

    python scripts/cluster_structures.py                  # downtown bbox (default)
    python scripts/cluster_structures.py --all            # the whole table
    python scripts/cluster_structures.py --dry-run        # report, write nothing

Toronto's 3D Massing carries no structure identifier, so parts are grouped
geometrically: two parts belong to the same structure when their footprints
*overlap*, when one contains the other, or when they are identical. Parts that
merely share an edge are left apart -- a party wall is a boundary between two
buildings, not one building.

Grouping is transitive (a podium joins the towers inside it, which joins
whatever those overlap), computed with union-find over the candidate pairs.
``structure_id`` is the lowest ``buildings.id`` in each group, which makes
reruns deterministic. Singletons get their own id, so every processed row has
one and each read path can treat ``structure_id`` as the building key.

Two more columns are filled while the groups are known, because computing them
per request is far too slow: ``structure_footprint_m2`` (the group's *union*
ground area, which is what absolute energy and emissions must divide by) and
``is_duplicate`` (parts whose footprint repeats one already counted -- kept in
the table, excluded from rendering and from any total).

The self-join is tiled; the ungated version does not finish in a sane time on
428k rows. Tiles carry a halo so a structure straddling a tile edge is still
seen whole, and union-find runs across all tiles at once, so the result does
not depend on the tiling.
"""

from __future__ import annotations

import argparse
import os
import time
from collections import defaultdict

from dotenv import dotenv_values
from sqlalchemy import create_engine, text

# The window the app actually renders, from scripts/build_grid.py.
DOWNTOWN_BBOX = (-79.41, 43.63, -79.36, 43.66)
TILE_DEG = 0.01
# ~55 m at this latitude: wider than any plausible overlap, so a structure
# spanning a tile edge is caught from both sides.
HALO_DEG = 0.0005

PAIR_SQL = """
WITH b AS (
    SELECT id, ST_Force2D(geom) AS g
    FROM buildings
    WHERE geom && ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
)
SELECT a.id AS a, c.id AS b
FROM b a
JOIN b c ON a.id < c.id AND a.g && c.g
WHERE ST_Overlaps(a.g, c.g)
   OR ST_Contains(a.g, c.g)
   OR ST_Contains(c.g, a.g)
   OR ST_Equals(a.g, c.g)
"""

DUPES_SQL = """
SELECT id FROM (
    SELECT id, row_number() OVER (
        PARTITION BY ST_AsBinary(ST_Force2D(geom)) ORDER BY id
    ) AS rn
    FROM buildings WHERE id = ANY(:ids)
) q WHERE rn > 1
"""

AREA_SQL = """
SELECT ST_Area(geography(ST_Union(ST_Force2D(geom))))
FROM buildings WHERE id = ANY(:ids)
"""


class UnionFind:
    """Keeps the lowest id as each group's representative."""

    def __init__(self) -> None:
        self._parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self._parent.setdefault(x, x)
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[x] != root:  # path compression
            self._parent[x], x = root, self._parent[x]
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[max(ra, rb)] = min(ra, rb)


def engine_from_env():
    url = (
        dotenv_values(".env").get("TIGERDATA_URL")
        or os.environ.get("TIGERDATA_URL")
        or ""
    ).strip()
    if not url:
        raise SystemExit("TIGERDATA_URL is not set (backend/.env or environment)")
    for scheme in ("postgresql://", "postgres://"):
        if url.startswith(scheme):
            url = "postgresql+psycopg://" + url[len(scheme):]
            break
    return create_engine(url, pool_pre_ping=True)


def tiles(bbox):
    lon_min, lat_min, lon_max, lat_max = bbox
    lon = lon_min
    while lon < lon_max:
        lat = lat_min
        while lat < lat_max:
            yield (
                lon - HALO_DEG,
                lat - HALO_DEG,
                min(lon + TILE_DEG, lon_max) + HALO_DEG,
                min(lat + TILE_DEG, lat_max) + HALO_DEG,
            )
            lat += TILE_DEG
        lon += TILE_DEG


def bbox_params(bbox):
    return dict(zip(("lon_min", "lat_min", "lon_max", "lat_max"), bbox))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true",
                    help="cluster the whole table instead of the downtown bbox")
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    engine = engine_from_env()
    with engine.begin() as conn:
        if args.all:
            r = conn.execute(text("""
                SELECT ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)
                FROM (SELECT ST_Extent(geom) AS e FROM buildings) q
            """)).one()
            bbox = (float(r[0]), float(r[1]), float(r[2]), float(r[3]))
        else:
            bbox = DOWNTOWN_BBOX
        print(f"bbox: {bbox[0]:.4f},{bbox[1]:.4f} .. {bbox[2]:.4f},{bbox[3]:.4f}")

        ids = [r[0] for r in conn.execute(text("""
            SELECT id FROM buildings
            WHERE geom && ST_MakeEnvelope(:lon_min, :lat_min, :lon_max, :lat_max, 4326)
            ORDER BY id
        """), bbox_params(bbox))]
        print(f"parts in scope: {len(ids):,}")
        if not ids:
            print("nothing to do")
            return 0

        uf = UnionFind()
        for i in ids:
            uf.find(i)

        tile_list = list(tiles(bbox))
        pair_count = 0
        t0 = time.perf_counter()
        for n, tile in enumerate(tile_list, 1):
            rows = conn.execute(text(PAIR_SQL), bbox_params(tile)).all()
            for a, b in rows:
                uf.union(a, b)
            pair_count += len(rows)
            if n % 5 == 0 or n == len(tile_list):
                print(f"  tile {n}/{len(tile_list)}  pairs: {pair_count:,}"
                      f"  ({time.perf_counter() - t0:.0f}s)")

        groups = defaultdict(list)
        for i in ids:
            groups[uf.find(i)].append(i)
        multi = {k: v for k, v in groups.items() if len(v) > 1}
        print(f"\nparts {len(ids):,} -> structures {len(groups):,}")
        print(f"  multi-part structures: {len(multi):,}")
        if multi:
            print(f"  largest: {max(len(v) for v in multi.values())} parts")

        dupes = set(conn.execute(text(DUPES_SQL), {"ids": ids}).scalars().all())
        print(f"  duplicate parts: {len(dupes):,}")

        if args.dry_run:
            print("\n--dry-run: no rows written")
            return 0

        print("\ncomputing union ground area per structure...")
        live = defaultdict(list)
        for i in ids:
            if i not in dupes:
                live[uf.find(i)].append(i)
        areas: dict[int, float] = {}
        t1 = time.perf_counter()
        for n, (gid, members) in enumerate(live.items(), 1):
            areas[gid] = conn.execute(text(AREA_SQL), {"ids": members}).scalar() or 0.0
            if n % 500 == 0 or n == len(live):
                print(f"  {n}/{len(live)}  ({time.perf_counter() - t1:.0f}s)")

        conn.execute(text("""
            CREATE TEMP TABLE _sid (
                id BIGINT PRIMARY KEY,
                structure_id BIGINT,
                structure_footprint_m2 DOUBLE PRECISION,
                is_duplicate BOOLEAN
            ) ON COMMIT DROP
        """))
        conn.execute(
            text("""
                INSERT INTO _sid (id, structure_id, structure_footprint_m2, is_duplicate)
                VALUES (:id, :structure_id, :structure_footprint_m2, :is_duplicate)
            """),
            [
                {
                    "id": i,
                    "structure_id": uf.find(i),
                    "structure_footprint_m2": areas.get(uf.find(i)),
                    "is_duplicate": i in dupes,
                }
                for i in ids
            ],
        )
        updated = conn.execute(text("""
            UPDATE buildings b
               SET structure_id = s.structure_id,
                   structure_footprint_m2 = s.structure_footprint_m2,
                   is_duplicate = s.is_duplicate
              FROM _sid s
             WHERE s.id = b.id
               AND (b.structure_id IS DISTINCT FROM s.structure_id
                 OR b.structure_footprint_m2 IS DISTINCT FROM s.structure_footprint_m2
                 OR b.is_duplicate IS DISTINCT FROM s.is_duplicate)
        """)).rowcount
        print(f"\nrows updated: {updated:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
