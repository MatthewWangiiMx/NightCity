# 3D building import

Put **unzipped** building data in `data/`, then run the importer from `backend/`:

```powershell
.\.venv\Scripts\Activate.ps1
python scripts/buildings/import_builds.py --dry-run   # look first
python scripts/buildings/import_builds.py             # write to TigerData
```

Readable formats: `.shp` (keep its `.dbf`/`.shx`/`.prj` sidecars beside it),
`.geojson`, `.json`, `.gpkg`. CityJSON and CityGML are not readable directly —
convert first, e.g. `cjio input.city.json export --format gpkg out.gpkg`.

Everything lands in one `buildings` table on TigerData:

| column | meaning |
| --- | --- |
| `geom` | footprint in EPSG:4326, Z preserved when the source has it |
| `height_m` | detected from height/heightroof/bldg_height/… |
| `levels` | detected from levels/num_floors/storeys/… |
| `properties` | every original attribute, as JSONB — nothing is discarded |
| `source_file` | which file the row came from; re-importing replaces those rows |

`data/` is gitignored: building extracts are large and are not project source.
