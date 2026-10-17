# NightCity

A **simulated** energy grid digital twin. Trigger a disruption
(solar drop, heat wave, EV surge, battery outage, storm) and watch a transparent optimizer
coordinate buildings, batteries, EV charging and renewables, with the trade-offs shown live.

All figures are produced by a deterministic simulator from synthetic inputs. Nothing here is
measured data.

## Layout

```
backend/            FastAPI + deterministic simulator + heuristic optimizer
  app/api/routes/   HTTP surface (health, district, scenarios, simulation, dispatch, buildings)
  app/schemas/      Pydantic contracts, mirrored in frontend/src/api/types.ts
  app/sim/          simulator.py, optimizer.py, scenarios.py, district.py
  app/db/           TigerData session, repository, migrations/001_init.sql
  scripts/build_grid.py  deterministic PostGIS distribution-tree builder
  app/llm/          optional Claude explanation layer (never authoritative)
frontend/           React + TypeScript + Vite + Tailwind
  src/pages/        Home, Explore, Simulate, Plan, Building Detail
  src/components/   map/ (isometric district + timeline), charts/ (Recharts), panels/
  src/demo/         hardcoded run data, standing in for the simulator
  src/hooks/        useRun (API with demo fallback), usePlayback
docs/               METRICS.md (equations), TIGERDATA.md (database setup)
```

The front end is complete against **hardcoded demo data** in `src/demo/fixtures.ts`. The backend
simulator and optimizer still raise `NotImplementedError`, so `/api/simulation/run` returns 501 and
`useRun` falls back to the fixtures. When the simulator lands, the UI switches to live output with
no component changes.

## Run it

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

1. Configure `backend/.env`:

   ```dotenv
   TIGERDATA_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   ```

2. Create the Python environment and install backend dependencies:

   ```powershell
   cd C:\Users\Samuel\Documents\htv\NightCity\backend
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

   ```powershell
   # Terminal 1
   cd C:\Users\Samuel\Documents\htv\NightCity\backend
   .\.venv\Scripts\Activate.ps1
   $env:USE_DATABASE = "true"
   uvicorn app.main:app --reload --port 8000

   # Terminal 2
   cd C:\Users\Samuel\Documents\htv\NightCity\frontend
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

1. `app/sim/simulator.py` — demand curve, solar/wind profiles, battery state machine, thermal model.
2. `app/sim/optimizer.py` — heuristic plan with comfort as a hard constraint.
3. Charts in `frontend/src/components/charts/` (Recharts) and flow animation in `DistrictMap`.
4. TigerData: apply `backend/app/db/migrations/001_init.sql`, then fill in `app/db/repository.py`.
