# NightCity

GridShift × WattWise — a **simulated** energy grid digital twin. Trigger a disruption
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
  app/llm/          optional Claude explanation layer (never authoritative)
  data/             odc_final_dataset_2024.csv — the published EWRB extract
frontend/           React + TypeScript + Vite + Tailwind
  src/pages/        Home, Explore, Simulate, Plan, Building Detail
  src/components/   map/ (isometric district + timeline), charts/ (Recharts), panels/
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

`GET /api/health` reports whether the database and LLM layer are wired up. Both are optional —
the app runs with `USE_DATABASE=false` and `ENABLE_LLM=false`.

## Next steps

1. `app/sim/simulator.py` — `simulate()` still raises: demand curve, solar/wind profiles, battery
   state machine, thermal model. The EWRB diurnal shapes in `app/sim/ewrb_profile.py` are a
   reasonable starting baseline for the demand curve.
2. Flow animation in `DistrictMap`.
3. Feed the Plan page's flexibility sliders into `RunRequest.params` so they drive a rerun instead
   of scaling the current plan.
