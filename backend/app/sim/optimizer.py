"""Heuristic, constrained optimizer.

Greedy peak shaving, not a linear program: every action has to carry a reason,
a constraint and an assumption for the Dispatch Review screen, and a greedy
merit order *is* that explanation. Levers are applied cheapest-and-least-
intrusive first — EV shifting, then pre-cooling, then the battery, with
curtailment only when explicitly allowed.

Three invariants keep the result honest:

* Energy is conserved. Shifted EV load reappears later, battery discharge is
  paid for by earlier charging at 1/efficiency, and pre-cooling consumes *more*
  total energy than doing nothing - it just consumes it earlier.
* No rebound. Moving load out of the peak must not build a bigger one later.
* Capacity is respected. Power ratings, the state-of-charge floor and the
  flexible share of EV load are hard ceilings.

Comfort is a hard constraint: `plan()` re-simulates its own proposal and backs
off until `validate()` returns clean, rather than trading comfort against cost.
"""

from dataclasses import dataclass, field

from app.schemas.models import (
    ActionKind,
    DispatchAction,
    RunRequest,
    TimeStep,
)
from app.sim.district import get_district
from app.sim.simulator import COMFORT_BOUNDS_C, STEP_MINUTES

HOURS_PER_STEP = STEP_MINUTES / 60.0

# --- Declared assumptions (illustrative placeholders, see docs/METRICS.md) ---

BATTERY_HOURS = 4.0          # energy capacity = rating x hours
BATTERY_SOC_FLOOR = 0.20     # never discharge below this
BATTERY_ROUND_TRIP = 0.92
EV_FLEXIBLE_SHARE = 0.60     # share of charging sessions declared deferrable
EV_RECOVERY_STEPS = 8        # deferred charging must land within ~2 hours
PRECOOL_SHARE_OF_DEMAND = 0.06   # cooling load that can be moved ahead of peak
PRECOOL_ENERGY_PENALTY = 1.15    # pre-cooling costs more kWh than it avoids
PRECOOL_LEAD_STEPS = 6           # how far ahead of the peak pre-cooling starts
# Placeholder thermal response until the RC model lands (Task B): degrees of
# indoor drift per MW of cooling moved, per step.
PRECOOL_DEGREES_PER_MW_STEP = 0.010
DEFAULT_PEAK_REDUCTION = 0.20    # shave 20% unless the caller asks otherwise


@dataclass
class PlannedAction:
    """An action plus the per-step profiles that make it real.

    `DispatchAction` carries a single headline MW figure for the UI; the
    optimizer needs the whole shape, so it is kept alongside rather than
    squeezed into the wire contract.
    """

    action: DispatchAction
    demand_delta: list[float] = field(default_factory=list)   # MW added to district demand
    battery_discharge: list[float] = field(default_factory=list)  # MW, + discharge / - charge
    indoor_delta: list[float] = field(default_factory=list)   # degrees C applied to indoor temp


@dataclass
class Plan:
    actions: list[PlannedAction] = field(default_factory=list)
    target_mw: float = 0.0
    shortfall_mw: float = 0.0   # how much of the target the levers could not reach

    @property
    def dispatch_actions(self) -> list[DispatchAction]:
        return [planned.action for planned in self.actions]


# --- Helpers -----------------------------------------------------------------


def _zeros(n: int) -> list[float]:
    return [0.0] * n


def _headroom_mwh(
    candidates: list[int], baseline: list[TimeStep], added: list[float], ceiling: float
) -> float:
    """How much energy these steps can still absorb under the ceiling.

    Levers size themselves against this instead of displacing more load than
    the off-peak window can hold.
    """
    return sum(
        max(0.0, ceiling - (float(baseline[i].grid_import_mw or 0.0) + added[i])) * HOURS_PER_STEP
        for i in candidates
    )


def _allocate(
    energy_mwh: float,
    candidates: list[int],
    baseline: list[TimeStep],
    added: list[float],
    ceiling: float,
) -> list[float]:
    """Valley-fill `energy_mwh` into `candidates` without breaching `ceiling`.

    Recovered load has to land somewhere, and dropping it flat onto the steps
    just after the peak is how demand response creates a second, taller peak.
    Filling the deepest valleys first is what stops that happening, and it is
    why `added` is shared across levers: each one sees what the previous ones
    already put down.
    """
    placed = _zeros(len(baseline))
    if energy_mwh <= 0 or not candidates:
        return placed

    remaining = energy_mwh
    # Several passes: each one tops the valleys up to the current shallowest
    # level, so load spreads outward instead of piling onto one step.
    for _ in range(12):
        headroom = {
            i: max(0.0, ceiling - (float(baseline[i].grid_import_mw or 0.0) + added[i] + placed[i]))
            for i in candidates
        }
        open_steps = [i for i, h in headroom.items() if h > 1e-6]
        if not open_steps or remaining <= 1e-6:
            break
        share_mwh = remaining / len(open_steps)
        for i in open_steps:
            mw = min(share_mwh / HOURS_PER_STEP, headroom[i])
            placed[i] += mw
            remaining -= mw * HOURS_PER_STEP

    if remaining > 1e-6 and candidates:
        # Nowhere left under the ceiling; spread the remainder evenly and let
        # validate() catch the rebound rather than hiding it here.
        mw = remaining / (len(candidates) * HOURS_PER_STEP)
        for i in candidates:
            placed[i] += mw

    for i in candidates:
        added[i] += placed[i]
    return placed


def peak_window(steps: list[TimeStep], threshold: float = 0.9) -> tuple[int, int]:
    """Contiguous span around the peak where import stays within `threshold`.

    Returns inclusive (start, end) indices. This is the span worth shaving;
    shaving outside it moves energy without touching the number that matters.
    """
    if not steps:
        return (0, -1)

    imports = [float(s.grid_import_mw or 0.0) for s in steps]
    peak = max(imports)
    if peak <= 0:
        return (0, -1)

    centre = imports.index(peak)
    cutoff = peak * threshold
    start = centre
    while start > 0 and imports[start - 1] >= cutoff:
        start -= 1
    end = centre
    while end < len(imports) - 1 and imports[end + 1] >= cutoff:
        end += 1
    return (start, end)


def _battery_rating(district_id: str) -> float:
    for asset in get_district(district_id).assets:
        if asset.kind == "battery":
            return float(asset.capacity_mw)
    return 0.0


def _ev_rating(district_id: str) -> float:
    for asset in get_district(district_id).assets:
        if asset.kind == "ev_charging":
            return float(asset.capacity_mw)
    return 0.0


# --- Levers ------------------------------------------------------------------
#
# Each lever returns (PlannedAction | None, mw_relieved). They are tried in
# merit order and each one is handed only the shortfall its predecessors left.


def _shift_ev(
    steps: list[TimeStep],
    window: tuple[int, int],
    need_mw: float,
    district_id: str,
    added: list[float],
    ceiling: float,
) -> tuple[PlannedAction | None, float]:
    """Defer flexible charging out of the peak. Free, invisible, energy-neutral."""
    start, end = window
    n = len(steps)
    span = end - start + 1
    shiftable = _ev_rating(district_id) * EV_FLEXIBLE_SHARE

    # Deferral only moves load later, so the recovery window is what limits it.
    recovery = [i for i in range(end + 1, min(end + 1 + EV_RECOVERY_STEPS, n))]
    absorbable_mwh = _headroom_mwh(recovery, steps, added, ceiling)
    mw = min(need_mw, shiftable, absorbable_mwh / (span * HOURS_PER_STEP) if span else 0.0)
    if mw <= 0.1:
        return (None, 0.0)

    demand_delta = _zeros(n)
    for i in range(start, end + 1):
        demand_delta[i] -= mw

    # The energy does not disappear - it lands after the peak, inside the
    # declared deadline, valley-filled so it does not build a second peak.
    moved_mwh = mw * span * HOURS_PER_STEP
    placed = _allocate(moved_mwh, recovery, steps, added, ceiling)
    for i in range(n):
        demand_delta[i] += placed[i]

    action = DispatchAction(
        id="shift_ev_charging",
        kind=ActionKind.SHIFT_EV_CHARGING,
        title="Shift EV charging",
        detail=f"Defer {mw:.0f} MW of flexible charging across the peak",
        target_asset="ev",
        delta_mw=round(mw, 1),
        reason=(
            f"Flattens the demand curve over steps {start}-{end} without touching "
            "any load an occupant would notice"
        ),
        constraint=(
            f"Only the {EV_FLEXIBLE_SHARE:.0%} of sessions declared flexible; all "
            f"deferred energy ({moved_mwh:.0f} MWh) is delivered within "
            f"{EV_RECOVERY_STEPS * STEP_MINUTES} minutes"
        ),
        assumption="Synthetic fleet; flexible share and deadline are declared inputs",
    )
    return (PlannedAction(action=action, demand_delta=demand_delta), mw)


def _precool(
    steps: list[TimeStep],
    window: tuple[int, int],
    need_mw: float,
    added: list[float],
    ceiling: float,
) -> tuple[PlannedAction | None, float]:
    """Cool ahead of the peak and coast through it.

    Costs more total energy than doing nothing, which is why it ranks below
    EV shifting: it buys peak relief with kWh. How much relief is available is
    set by the comfort band itself - the building can only be driven as far
    below the lower bound's margin as it can later drift back up toward the
    upper one.
    """
    start, end = window
    if start <= 0:
        return (None, 0.0)   # nothing ahead of the window to pre-cool into

    span = end - start + 1
    window_demand = [float(steps[i].demand_mw or 0.0) for i in range(start, end + 1)]
    cap = (sum(window_demand) / len(window_demand)) * PRECOOL_SHARE_OF_DEMAND

    # Thermal headroom decides the ceiling, not the other way round.
    lo, hi = COMFORT_BOUNDS_C
    indoors = [s.indoor_temp_c for s in steps[start : end + 1] if s.indoor_temp_c is not None]
    if indoors:
        headroom_up = max(0.0, hi - max(indoors))
        headroom_down = max(0.0, min(indoors) - lo)
        thermal_cap = (headroom_up + headroom_down) / (PRECOOL_DEGREES_PER_MW_STEP * span)
    else:
        headroom_down = 0.0
        thermal_cap = cap

    n = len(steps)
    lead = [i for i in range(max(0, start - PRECOOL_LEAD_STEPS), start)]
    # Pre-cooling has to fit its (inflated) energy into the lead-in window.
    absorbable_mwh = _headroom_mwh(lead, steps, added, ceiling) / PRECOOL_ENERGY_PENALTY
    mw = min(need_mw, cap, thermal_cap, absorbable_mwh / (span * HOURS_PER_STEP))
    if mw <= 0.1:
        return (None, 0.0)

    demand_delta = _zeros(n)
    indoor_delta = _zeros(n)

    # Pre-cool down by `depth`, then drift back up while coasting.
    drift_per_step = PRECOOL_DEGREES_PER_MW_STEP * mw
    depth = min(headroom_down, drift_per_step * span)
    for i in range(start, end + 1):
        demand_delta[i] -= mw
        indoor_delta[i] += -depth + drift_per_step * (i - start + 1)

    avoided_mwh = mw * span * HOURS_PER_STEP
    placed = _allocate(avoided_mwh * PRECOOL_ENERGY_PENALTY, lead, steps, added, ceiling)
    for i in lead:
        demand_delta[i] += placed[i]
        # The building is being driven down over the lead-in, deepest at the end.
        indoor_delta[i] -= depth * ((i - lead[0] + 1) / len(lead))

    action = DispatchAction(
        id="precool_buildings",
        kind=ActionKind.PRECOOL_BUILDING,
        title="Pre-cool flexible buildings",
        detail=f"Move {mw:.0f} MW of cooling ahead of the peak",
        target_asset="city",
        delta_mw=round(mw, 1),
        reason="Buys thermal headroom so cooling can idle through the peak",
        constraint=(
            f"Indoor temperature stays within {COMFORT_BOUNDS_C[0]:.0f}-"
            f"{COMFORT_BOUNDS_C[1]:.0f} C - a hard constraint, re-checked after planning"
        ),
        assumption=(
            f"Placeholder thermal response; pre-cooling consumes "
            f"{PRECOOL_ENERGY_PENALTY:.0%} of the energy it avoids"
        ),
    )
    return (
        PlannedAction(action=action, demand_delta=demand_delta, indoor_delta=indoor_delta),
        mw,
    )


def _discharge_battery(
    steps: list[TimeStep],
    window: tuple[int, int],
    need_mw: float,
    district_id: str,
    added: list[float],
    ceiling: float,
) -> tuple[PlannedAction | None, float]:
    """Discharge across the peak, paid for by charging beforehand."""
    start, end = window
    rating = _battery_rating(district_id)
    if rating <= 0:
        return (None, 0.0)

    span = end - start + 1
    n = len(steps)
    start_soc = float(steps[0].battery_soc or 0.0) if steps else 0.0
    energy_capacity = rating * BATTERY_HOURS
    usable_mwh = max(0.0, (start_soc - BATTERY_SOC_FLOOR) * energy_capacity)

    # Storage can recharge anywhere before the peak, so the whole run-up is
    # fair game - that is what puts charging in the midday solar valley rather
    # than in the hour before the peak, where it would rebuild it.
    lead = list(range(0, start))
    absorbable_mwh = _headroom_mwh(lead, steps, added, ceiling) * BATTERY_ROUND_TRIP

    mw = min(
        need_mw,
        rating,
        usable_mwh / (span * HOURS_PER_STEP) if span else 0.0,
        absorbable_mwh / (span * HOURS_PER_STEP) if span else 0.0,
    )
    if mw <= 0.1:
        return (None, 0.0)

    demand_delta = _zeros(n)
    discharge = _zeros(n)
    for i in range(start, end + 1):
        discharge[i] += mw

    # Charging is a real cost: the energy comes back through the meter earlier,
    # inflated by round-trip losses.
    discharged_mwh = mw * span * HOURS_PER_STEP
    charge_mwh = discharged_mwh / BATTERY_ROUND_TRIP
    placed = _allocate(charge_mwh, lead, steps, added, ceiling)
    for i in lead:
        charge_mw = min(placed[i], rating)
        discharge[i] -= charge_mw
        demand_delta[i] += charge_mw

    action = DispatchAction(
        id="discharge_battery",
        kind=ActionKind.BATTERY_DISCHARGE,
        title="Discharge neighbourhood battery",
        detail=f"Supply {mw:.0f} MW across the peak",
        target_asset="battery",
        delta_mw=round(mw, 1),
        reason="Covers the shortfall locally instead of importing it at peak",
        constraint=(
            f"State of charge held above {BATTERY_SOC_FLOOR:.0%}; discharge within the "
            f"{rating:.0f} MW rating"
        ),
        assumption=(
            f"Synthetic storage: {rating:.0f} MW / {energy_capacity:.0f} MWh, "
            f"{BATTERY_ROUND_TRIP:.0%} round-trip"
        ),
    )
    return (
        PlannedAction(action=action, demand_delta=demand_delta, battery_discharge=discharge),
        mw,
    )


def _curtail(
    steps: list[TimeStep], window: tuple[int, int], need_mw: float
) -> tuple[PlannedAction | None, float]:
    """Last resort: drop load outright. Never energy-neutral, always visible."""
    start, end = window
    if need_mw <= 0.1:
        return (None, 0.0)

    n = len(steps)
    demand_delta = _zeros(n)
    for i in range(start, end + 1):
        demand_delta[i] -= need_mw

    action = DispatchAction(
        id="curtail_flexible_load",
        kind=ActionKind.CURTAIL_FLEXIBLE_LOAD,
        title="Curtail non-critical load",
        detail=f"Shed {need_mw:.0f} MW across the peak",
        target_asset="city",
        delta_mw=round(need_mw, 1),
        reason="Every energy-neutral lever was exhausted before reaching for this one",
        constraint="Non-critical circuits only; this energy is not recovered later",
        assumption="Curtailment is opt-in and off by default",
    )
    return (PlannedAction(action=action, demand_delta=demand_delta), need_mw)


# --- Applying a plan ---------------------------------------------------------


def apply_plan(baseline: list[TimeStep], plan_obj: Plan, district_id: str = "nightcity") -> list[TimeStep]:
    """Re-derive the series with the plan in force.

    Grid import is recomputed from first principles each step, so the result
    cannot drift away from demand, generation and storage.
    """
    if not baseline:
        return []

    n = len(baseline)
    demand_delta = _zeros(n)
    discharge = _zeros(n)
    indoor_delta = _zeros(n)
    for planned in plan_obj.actions:
        for i in range(n):
            if planned.demand_delta:
                demand_delta[i] += planned.demand_delta[i]
            if planned.battery_discharge:
                discharge[i] += planned.battery_discharge[i]
            if planned.indoor_delta:
                indoor_delta[i] += planned.indoor_delta[i]

    rating = _battery_rating(district_id)
    energy_capacity = max(rating * BATTERY_HOURS, 1e-9)
    soc = float(baseline[0].battery_soc or 0.0)

    out: list[TimeStep] = []
    for i, step in enumerate(baseline):
        demand = max(0.0, float(step.demand_mw or 0.0) + demand_delta[i])
        solar = float(step.solar_mw or 0.0)
        wind = float(step.wind_mw or 0.0)
        battery = discharge[i]

        # Track state of charge so validate() can check it rather than trust it.
        if battery > 0:
            soc -= (battery * HOURS_PER_STEP) / energy_capacity
        elif battery < 0:
            soc += (-battery * HOURS_PER_STEP * BATTERY_ROUND_TRIP) / energy_capacity
        soc = min(max(soc, 0.0), 1.0)

        indoor = step.indoor_temp_c
        if indoor is not None:
            indoor = indoor + indoor_delta[i]

        out.append(
            TimeStep(
                t=step.t,
                demand_mw=round(demand, 3),
                solar_mw=solar,
                wind_mw=wind,
                battery_mw=round(battery, 3),
                battery_soc=round(soc, 4),
                grid_import_mw=round(max(0.0, demand - solar - wind - battery), 3),
                indoor_temp_c=None if indoor is None else round(indoor, 2),
                building_id=step.building_id,
            )
        )
    return out


# --- Planning ----------------------------------------------------------------


def build_plan(
    req: RunRequest,
    baseline: list[TimeStep],
    target_reduction: float | None = None,
) -> Plan:
    """Greedy pass over the levers for one target reduction."""
    plan_obj = Plan()
    if not baseline:
        return plan_obj

    window = peak_window(baseline)
    if window[1] < window[0]:
        return plan_obj

    peak = max(float(s.grid_import_mw or 0.0) for s in baseline)
    reduction = (
        target_reduction
        if target_reduction is not None
        else req.params.get("peak_reduction_pct", DEFAULT_PEAK_REDUCTION)
    )
    plan_obj.target_mw = peak * reduction
    remaining = plan_obj.target_mw

    # Everything displaced by the levers has to land under this line, or the
    # plan has simply moved the peak rather than shaved it.
    ceiling = peak - plan_obj.target_mw
    added = _zeros(len(baseline))

    # Merit order: free and invisible first, costly and visible last.
    levers = []
    planned, relieved = _shift_ev(baseline, window, remaining, req.district_id, added, ceiling)
    if planned:
        levers.append(planned)
        remaining -= relieved

    planned, relieved = _precool(baseline, window, remaining, added, ceiling)
    if planned:
        levers.append(planned)
        remaining -= relieved

    planned, relieved = _discharge_battery(
        baseline, window, remaining, req.district_id, added, ceiling
    )
    if planned:
        levers.append(planned)
        remaining -= relieved

    if remaining > 0.1 and req.params.get("allow_curtailment", 0):
        planned, relieved = _curtail(baseline, window, remaining)
        if planned:
            levers.append(planned)
            remaining -= relieved

    plan_obj.actions = levers
    plan_obj.shortfall_mw = round(max(0.0, remaining), 2)
    return plan_obj


def plan(req: RunRequest, baseline: list[TimeStep]) -> list[DispatchAction]:
    """Choose among battery discharge, EV shifting and HVAC pre-cooling.

    The plan is re-simulated and validated; if it violates a constraint the
    target is backed off and the pass repeats. A plan that cannot be made
    admissible comes back short rather than pretending.
    """
    return planned_result(req, baseline)[0]


def planned_result(
    req: RunRequest, baseline: list[TimeStep]
) -> tuple[list[DispatchAction], list[TimeStep], list[str]]:
    """Full optimizer output: actions, the series they produce, any violations.

    `plan()` keeps the narrow published signature; callers that need the
    optimized series (the simulator, the run endpoint) use this instead and
    avoid re-deriving it.
    """
    if not baseline:
        return ([], [], [])

    target = req.params.get("peak_reduction_pct", DEFAULT_PEAK_REDUCTION)
    violations: list[str] = []

    # Back off toward gentler plans until one is admissible.
    for reduction in (target, target * 0.75, target * 0.5, target * 0.25):
        candidate = build_plan(req, baseline, target_reduction=reduction)
        optimized = apply_plan(baseline, candidate, req.district_id)
        violations = validate(candidate.dispatch_actions, optimized, baseline)
        if not violations:
            return (candidate.dispatch_actions, optimized, [])

    # Nothing admissible: return the baseline untouched and say why.
    return ([], list(baseline), violations)


# --- Validation --------------------------------------------------------------


def validate(
    actions: list[DispatchAction],
    steps: list[TimeStep],
    baseline: list[TimeStep] | None = None,
) -> list[str]:
    """Return violated constraints; empty means the plan is admissible.

    Runs against the *re-simulated* series, never the baseline - a plan's own
    pre-cooling has to be included before comfort can be judged.
    """
    problems: list[str] = []
    if not steps:
        return problems

    lo, hi = COMFORT_BOUNDS_C
    rating = _battery_rating("nightcity")

    for i, step in enumerate(steps):
        temp = step.indoor_temp_c
        if temp is not None and (temp < lo or temp > hi):
            problems.append(
                f"Comfort: indoor {temp:.1f} C at step {i} is outside {lo:.0f}-{hi:.0f} C"
            )
        if step.battery_soc < BATTERY_SOC_FLOOR - 1e-6:
            problems.append(
                f"Storage: state of charge {step.battery_soc:.0%} at step {i} is below "
                f"the {BATTERY_SOC_FLOOR:.0%} floor"
            )
        if step.battery_soc > 1.0 + 1e-6:
            problems.append(f"Storage: state of charge above 100% at step {i}")
        if rating > 0 and abs(step.battery_mw) > rating + 1e-6:
            problems.append(
                f"Storage: {abs(step.battery_mw):.0f} MW at step {i} exceeds the "
                f"{rating:.0f} MW rating"
            )

    if baseline:
        base_peak = max(float(s.grid_import_mw or 0.0) for s in baseline)
        new_peak = max(float(s.grid_import_mw or 0.0) for s in steps)
        if new_peak > base_peak + 1e-6:
            problems.append(
                f"Rebound: new peak {new_peak:.0f} MW exceeds the baseline peak "
                f"{base_peak:.0f} MW"
            )

        # Energy conservation: shifting must not quietly delete demand. Only
        # curtailment is allowed to, and only by the amount it declares.
        curtailed = sum(
            a.delta_mw for a in actions if a.kind == ActionKind.CURTAIL_FLEXIBLE_LOAD
        )
        base_mwh = sum(float(s.demand_mw or 0.0) for s in baseline) * HOURS_PER_STEP
        new_mwh = sum(float(s.demand_mw or 0.0) for s in steps) * HOURS_PER_STEP
        if curtailed <= 0 and new_mwh < base_mwh - 1e-6:
            problems.append(
                f"Energy: optimized demand {new_mwh:.0f} MWh is below baseline "
                f"{base_mwh:.0f} MWh with no curtailment declared"
            )

    # De-duplicate while keeping order, so one repeated fault reads as one fault.
    seen: set[str] = set()
    unique: list[str] = []
    for problem in problems:
        key = problem.split(" at step ")[0]
        if key not in seen:
            seen.add(key)
            unique.append(problem)
    return unique
