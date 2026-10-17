import json
import math

d = json.load(open("frontend/public/data/toronto-massing.json", encoding="utf-8"))
ORIGIN_LAT, ORIGIN_LON = 43.6426, -79.3871
rows = []
for b in d["buildings"]:
    ring = b["rings"][0]
    body = ring[:-1] if ring[0] == ring[-1] else ring
    cx = sum(p[0] for p in body) / len(body)
    cz = sum(p[1] for p in body) / len(body)
    lon = ORIGIN_LON + cx / (math.cos(math.radians(ORIGIN_LAT)) * 111320)
    lat = ORIGIN_LAT - cz / 110540
    if b["h"] >= 100:
        rows.append((b["h"], lat, lon, cx, cz))
rows.sort(reverse=True)
for r in rows[:40]:
    print(f"h={r[0]:6.1f} lat={r[1]:.5f} lon={r[2]:.5f} cx={r[3]:.0f} cz={r[4]:.0f}")
print("total>=100", len(rows))
