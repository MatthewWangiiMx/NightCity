# NightCity

A **simulated** energy grid digital twin. Trigger a disruption
(solar drop, heat wave, EV surge, battery outage, storm) and watch a transparent optimizer
coordinate buildings, batteries, EV charging and renewables, with the trade-offs shown live.

Scenarios, dispatch and the time series are produced by a deterministic simulator from synthetic
inputs. One layer is real: the `/api/ewrb` endpoints serve annual energy, water and emissions
intensities that building operators reported to Ontario's Energy and Water Reporting and
Benchmarking programme. Every EWRB payload states which of its fields are measured and which are
derived, and the UI marks the two differently.

## Layout

```
backend/            FastAPI + deterministic simulator + heuristic optimizer
  app/api/routes/   HTTP surface (health, district, scenarios, simulation, dispatch,
                    buildings, weather, ewrb)
  app/schemas/      Pydantic contracts, mirrored in frontend/src/api/types.ts
  app/sim/          simulator.py, optimizer.py, scenarios.py, district.py,
                    ewrb_profile.py (reported intensity -> per-building profile)
  app/data/         ewrb.py — the reported EWRB dataset, units normalised
  app/db/           TigerData session, repository, migrations/001_init.sql
  scripts/build_grid.py  deterministic PostGIS distribution-tree builder
  scripts/cluster_structures.py  groups 3D Massing parts into logical structures
  app/llm/          optional Claude explanation layer (never authoritative)
  data/             odc_final_dataset_2024.csv — the published EWRB extract
frontend/           React + TypeScript + Vite + Tailwind
  src/pages/        Home, Explore, Simulate, Plan, Building Detail
  src/components/   map/ (3D city viewer + timeline), charts/ (Recharts), panels/
  src/demo/         hardcoded run data, standing in for the simulator
  src/hooks/        useRun (API with demo fallback), usePlayback
docs/               METRICS.md (equations), TIGERDATA.md (database setup)
```

The front end is complete against **hardcoded demo data** in `src/demo/fixtures.ts`. The heuristic
optimizer in `app/sim/optimizer.py` is implemented; the scenario engine in `app/sim/simulator.py`
still raises `NotImplementedError` from `simulate()`, so `/api/simulation/run` returns 501 and
`useRun` falls back to the fixtures. When the simulator lands, the UI switches to live output with
no component changes.

The EWRB layer is independent of all that and works today. Clicking a building in Explore City
opens its reported benchmark; Simulate and Plan read district-level rollups. The dataset is
optional — without `backend/data/odc_final_dataset_2024.csv` those endpoints answer 503 and the UI
falls back to its own estimates.

### What EWRB can and cannot tell you

EWRB rows carry a city and a three-character postal FSA, never coordinates or an address, so **no
key joins a reported row to a 3D Massing footprint**. A building on the map is therefore matched to
a *cohort* (FSA + property type, widening to city or province when the sample is thin) and given a
fixed position in that cohort's reported spread, from a hash of its id. The intensity shown is a
real filed value from a real comparable property; attributing it to that particular building is an
estimate. `basis`, `scope`, `sample_size` and `comparable_ewrb_id` say so on every payload.

Absolute MWh and tCO₂e need floor area, which EWRB does not publish — that comes from the massing,
so the totals need TigerData. Intensities work without it.

The published file also contains a tail of impossible filings (the worst site EUI in it is
4,477,023 kWh/m²·yr). `PLAUSIBLE_RANGE` in `app/data/ewrb.py` screens these out per metric and every
distribution reports how many it excluded.

## Run it

All paths below are relative to the repository root — `cd` there first, in each
terminal.

Backend (Python 3.12+):

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env     # fill in TIGERDATA_URL when ready
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173, /api proxied to :8000
```

### Build and view the downtown distribution grid

The grid builder requires Python, PostGIS, and a TigerData connection URL. Do
not commit `backend/.env`; it contains the database credential.

Step 2 changes into `backend/`, and steps 3 to 5 run from there.

1. Configure `backend/.env`:

   ```dotenv
   TIGERDATA_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   ```

2. Create the Python environment and install backend dependencies:

   ```powershell
   cd backend
   py -3 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

   If the virtual environment already exists and step 3 reports
   `ModuleNotFoundError: No module named 'geopandas'`, install the importer
   dependencies into that same active environment:

   ```powershell
   python -m pip install -r scripts\buildings\requirements.txt
   ```

3. Ensure the source table exists and contains PostGIS geometries. If the
   buildings have not been imported yet, place the source files in
   `backend/scripts/buildings/data` and run:

   ```powershell
   python scripts/buildings/import_builds.py --replace
   ```

   `No readable files found` is expected when the database was already
   populated and no source files are present in that local folder. In that
   case, skip the importer and continue with step 4.

4. Apply the grid schema once:

   ```powershell
   psql "$env:TIGERDATA_URL" -f app/db/migrations/003_grid.sql
   ```

   If `psql` is unavailable, run the SQL file through the TigerData SQL
   console instead. The existing building-import script also creates the
   `postgis` extension and `buildings` table when needed.

5. Build the grid:

   ```powershell
   python scripts/build_grid.py
   ```

   The script reads the downtown extent from PostGIS, assigns every building
   to exactly one transformer, creates the substation/feeder/transformer tree
   and normally-open feeder ties, and rebuilds `grid_nodes`, `grid_edges`, and
   `building_nodes` in one transaction. `grid_nodes` contains only the
   substation, feeder, and transformer infrastructure; `building_nodes` is the
   only database mapping from buildings to transformers. It then writes:

   - `frontend/public/data/grid.json` for the viewer.
   - `frontend/public/data/toronto-massing.json` with a `node_id` on every
     massing building.

6. Start the app:

   Each terminal starts at the repository root:

   ```powershell
   # Terminal 1
   cd backend
   .\.venv\Scripts\Activate.ps1
   $env:USE_DATABASE = "true"
   uvicorn app.main:app --reload --port 8000

   # Terminal 2
   cd frontend
   npm install
   npm run dev
   ```

   Open `http://localhost:5173/explore`. The viewer loads `grid.json`, showing
   substation, feeder, and transformer pucks with lines between them. Closed
   edges are cyan; normally-open ties are amber.

To rebuild after importing updated buildings, rerun only
`python scripts/build_grid.py`. The generated tables are truncated and rebuilt
transactionally, and stable spatial bins plus sorted identifiers make reruns
deterministic. A failed transaction leaves the prior committed grid intact.

The generated model contains approximately 36 infrastructure nodes: one
substation, five feeders, and thirty transformers. Buildings are not nodes in
`grid_nodes`; each building appears once in `building_nodes` and points to its
transformer. `grid.json` contains only infrastructure nodes and edges, plus
metadata explaining that this is a radial approximation rather than Toronto
Hydro's real meshed downtown network. Its three amber tie edges are normally
open and are excluded from the closed radial connectivity model until a later
scenario closes them.

Useful checks:

```powershell
# Confirm the generated browser artifact is valid JSON.
python -c "import json; json.load(open(r'..\frontend\public\data\grid.json', encoding='utf-8')); print('grid.json OK')"

# Confirm the backend can reach TigerData.
Invoke-RestMethod http://localhost:8000/api/health
```

For a direct database check, run the following in the TigerData SQL console:

```sql
SELECT node_type, count(*) FROM grid_nodes GROUP BY node_type ORDER BY node_type;
SELECT count(*) AS building_mappings FROM building_nodes;
SELECT edge_id, parent_id, child_id
FROM grid_edges
WHERE is_tie AND normally_open
ORDER BY edge_id;
```

`GET /api/health` reports whether the database and LLM layer are wired up. Both are optional —
the app runs with `USE_DATABASE=false` and `ENABLE_LLM=false`.

## Next steps

1. `app/sim/simulator.py` — `simulate()` still raises: demand curve, solar/wind profiles, battery
   state machine, thermal model. The EWRB diurnal shapes in `app/sim/ewrb_profile.py` are a
   reasonable starting baseline for the demand curve.
2. Feed the Plan page's flexibility sliders into `RunRequest.params` so they drive a rerun instead
   of scaling the current plan.
