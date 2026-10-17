# 3D building import

Put **unzipped** building data in `data/`, then run the importer from `backend/`:

```powershell
.\.venv\Scripts\Activate.ps1
# Downtown Toronto 3D Massing (already downloaded under tmp/massing):
python scripts/buildings/import_builds.py `
  ..\tmp\massing\extracted\3DMassingShapefile_2025_WGS84.shp `
  --bbox -79.41,43.63,-79.36,43.66 `
  --dry-run
python scripts/buildings/import_builds.py `
  ..\tmp\massing\extracted\3DMassingShapefile_2025_WGS84.shp `
  --bbox -79.41,43.63,-79.36,43.66
```

Requires `USE_DATABASE=true` and a real `TIGERDATA_URL` in `backend/.env`.

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
