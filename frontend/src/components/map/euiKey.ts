import type { MassingBuilding } from '@/api/client';
import { localToLonLat } from '@/components/map/torontoLandmarks';

/**
 * The EWRB cohort key for a building on the map.
 *
 * The backend places a building in its reported cohort by hashing this string,
 * so it decides which real filed property the building is shown as. Every
 * request about the same building has to send the same string, or the panel
 * reports an intensity the map did not paint.
 *
 * The authoritative value is `eui_key`, derived from the structure's geometry
 * and stored by `scripts/cluster_structures.py`. The other branches exist only
 * for payloads that predate it:
 *
 * - `structure_id` is a BIGSERIAL, so a re-import reassigns it and the building
 *   then draws a different comparable -- the CN Tower moved from 444.8 to 115.2
 *   kWh/m2*yr that way, rank 25 of its 26-row cohort to rank 1. Kept as the
 *   first fallback so a database that has been clustered but not yet migrated
 *   behaves exactly as it did before, instead of quietly changing every number.
 * - the ring centroid is for the static cache in
 *   `public/data/toronto-massing.json`, which carries no identifier at all.
 *   Without it that path falls back to the array index, so the same building
 *   reads differently depending only on whether the database is reachable.
 *
 * The two paths do not key identically, and are not expected to. The cache is
 * one row per *part* while the database is one row per *structure*, so a
 * podium-plus-tower complex cannot line up at all. Even a single-part building
 * lines up only about 88% of the time (3,765 of 4,297 measured downtown): the
 * rings here are inset and simplified for rendering, so their centroid sits a
 * metre or two off the raw footprint centroid the database keys on, which at
 * this precision is sometimes the next cell over.
 *
 * Deriving the stored key from these rendered rings instead would make the two
 * agree, at the price of pinning every building's reported intensity to
 * INSET_M and the simplification budget -- change how the city is drawn and
 * every number moves. Raw geometry is the stabler source. What matters is that
 * each path is internally consistent and survives a re-import, and both now do.
 */

// Matches KEY_PRECISION in scripts/cluster_structures.py: ~1.1 m of latitude,
// ~0.8 m of longitude here. Must stay in step with it, or the cached artifact
// keys into different cells than the database does.
const KEY_PRECISION = 5;

/** Area centroid of a closed ring in the local metre frame, by the shoelace
 *  formula -- the same point PostGIS ST_Centroid returns. A degenerate ring
 *  (zero area, as a collapsed footprint can be) falls back to the vertex mean. */
function ringCentroid(ring: [number, number][]): [number, number] | null {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return null;

  let twiceArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const cross = x0 * z1 - x1 * z0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const n = pts.length;
    return [
      pts.reduce((acc, p) => acc + p[0], 0) / n,
      pts.reduce((acc, p) => acc + p[1], 0) / n,
    ];
  }
  return [cx / (3 * twiceArea), cz / (3 * twiceArea)];
}

function geometryKey(ring: [number, number][]): string | null {
  const centre = ringCentroid(ring);
  if (!centre) return null;
  const { lat, lon } = localToLonLat(centre[0], centre[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `tiger-g${lat.toFixed(KEY_PRECISION)},${lon.toFixed(KEY_PRECISION)}`;
}

export function euiKeyFor(b: MassingBuilding, index: number): string {
  if (b.eui_key) return b.eui_key;
  if (b.structure_id != null) return `tiger-s${b.structure_id}`;
  if (b.id != null) return `tiger-${b.id}`;
  const ring = b.rings?.[0];
  if (ring && ring.length >= 3) {
    const key = geometryKey(ring);
    if (key) return key;
  }
  return `b-${index}`;
}
