# Metrics

Every number the UI shows comes from the deterministic simulator and is defined here.
Constants live in `backend/app/sim/simulator.py` and are illustrative placeholders.

| Metric | Equation | Notes |
| --- | --- | --- |
| Peak demand (MW) | `max(grid_import_mw)` over the window | District grid import, not local generation |
| Energy cost ($) | `Σ(grid_import_mw × hours) × PRICE_PER_MWH` | `PRICE_PER_MWH = 95.0` (declared, flat) |
| Estimated emissions (tCO₂e) | `Σ(grid_import_mw × hours) × EMISSIONS_FACTOR_T_PER_MWH` | `0.38 t/MWh`; always labeled an estimate |
| Comfort violations (min) | minutes where `indoor_temp_c` is outside `COMFORT_BOUNDS_C` | `(20.0, 24.0) °C`; never hidden |
| Renewable utilization (%) | renewable energy used locally ÷ renewable energy available | Curtailed output counts as available, not used |

Window and resolution: `STEP_MINUTES = 15`.

## Rules

- Comfort is a **hard constraint**. A plan that violates the bounds is rejected by
  `optimizer.validate()`, not traded off against cost or emissions.
- Baseline and optimized runs use **identical inputs**; only the dispatch plan differs.
- The LLM layer narrates these numbers and never produces them. If the API call fails,
  the deterministic `reason` text on each action is shown instead.
- Everything is simulated. Present as a prototype digital twin, not measured results.
