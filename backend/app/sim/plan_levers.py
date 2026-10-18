"""What-if levers for the Plan page, applied to reported building data.

Every lever here changes *energy consumed*, not just where it comes from. That
distinction matters: a supply-mix slider changes emissions per kWh and leaves
consumption untouched, while these four change the kWh itself.

Emission factors are derived from the EWRB filings rather than looked up. A
least-squares fit of

    ghg_kg_m2 = a * elec_kwh_m2 + b * gas_kwh_m2

over the 5,606 rows reporting all three gives a = 0.0360 and b = 0.1621 kg
CO2e/kWh, reproducing reported emissions to a 6% median error. Natural gas is
therefore 4.5x as carbon-intensive per kWh as Ontario grid electricity, which is
why electrifying heat is the single largest lever available.

(For comparison, simulator.py still carries EMISSIONS_FACTOR_T_PER_MWH = 0.38
for grid electricity - more than ten times the value the data supports.)
"""

from __future__ import annotations

from typing import Any

# --- Derived from the EWRB filings (see module docstring) -----------------
ELEC_KG_PER_KWH = 0.0360
GAS_KG_PER_KWH = 0.1621

# --- Declared engineering assumptions -------------------------------------
# Seasonal efficiency of the gas heating being displaced. Condensing boilers
# reach ~0.95, older atmospheric units ~0.75; 0.85 is a mixed-stock figure.
BOILER_EFFICIENCY = 0.85

# Seasonal COP of a cold-climate heat pump over a Toronto heating season,
# including backup resistance on the coldest days. Manufacturers quote higher
# at mild temperatures; this is the seasonal average.
DEFAULT_HEAT_PUMP_COP = 3.0

# Heating energy saved per degree C the setpoint is relaxed. Heating demand is
# roughly proportional to heating degree-days, and widening the deadband moves
# the balance point, so the saving is close to linear over a few degrees.
HEATING_SAVING_PER_C = 0.06

# Share of lighting electricity a full LED retrofit removes.
LIGHTING_RETROFIT_SAVING = 0.50

# --- Heat pump performance against outdoor temperature --------------------
# Air-source units are rated at 8.3 C (47 F). Both capacity and efficiency
# fall as it gets colder; 0.08 COP per degree is a mid-range figure for a
# cold-climate unit, and MIN_HEAT_PUMP_COP is where backup resistance heat
# effectively takes over.
COP_RATING_TEMP_C = 8.3
COP_DERATE_PER_C = 0.08
MIN_HEAT_PUMP_COP = 1.0

# Hours a building's load trails the outdoor temperature, from thermal mass.
THERMAL_LAG_HOURS = 2

# --- Hourly shapes for the non-thermal end uses ---------------------------
# 24 multipliers of each component's own daily average. Lighting follows
# occupancy and daylight, plug load occupancy alone. EWRB reports annual
# totals only -- there is no hourly data in the dataset -- so these are
# typical profiles, not measurements, and the payload says so. The HVAC
# component does not appear here: when hourly temperatures are available it is
# built from them instead, which is the point of the split.
def _mean_one(values: tuple[float, ...]) -> tuple[float, ...]:
    """Rescale a hand-written shape to average exactly 1.0."""
    mean = sum(values) / len(values)
    return tuple(v / mean for v in values)


COMPONENT_SHAPES: dict[str, dict[str, tuple[float, ...]]] = {
    "lighting": {
        "residential": _mean_one((
            0.35, 0.30, 0.28, 0.28, 0.30, 0.45, 0.80, 1.00, 0.85, 0.60, 0.50, 0.48,
            0.48, 0.48, 0.52, 0.65, 1.10, 1.70, 2.05, 2.10, 1.95, 1.60, 1.05, 0.63,
        )),
        "commercial": _mean_one((
            0.25, 0.22, 0.22, 0.22, 0.25, 0.45, 0.85, 1.30, 1.60, 1.65, 1.65, 1.65,
            1.62, 1.65, 1.65, 1.60, 1.45, 1.15, 0.80, 0.55, 0.42, 0.35, 0.30, 0.27,
        )),
        "continuous": _mean_one((
            0.60, 0.58, 0.57, 0.57, 0.60, 0.70, 0.90, 1.10, 1.25, 1.30, 1.32, 1.32,
            1.30, 1.32, 1.32, 1.28, 1.20, 1.10, 1.00, 0.92, 0.85, 0.78, 0.70, 0.64,
        )),
    },
    "plug": {
        "residential": _mean_one((
            0.60, 0.55, 0.52, 0.50, 0.52, 0.60, 0.78, 0.92, 0.95, 0.88, 0.82, 0.80,
            0.82, 0.82, 0.85, 0.92, 1.10, 1.35, 1.55, 1.60, 1.52, 1.35, 1.10, 0.82,
        )),
        "commercial": _mean_one((
            0.40, 0.38, 0.37, 0.37, 0.40, 0.50, 0.70, 1.00, 1.30, 1.45, 1.50, 1.52,
            1.48, 1.50, 1.50, 1.45, 1.30, 1.05, 0.80, 0.62, 0.52, 0.47, 0.43, 0.40,
        )),
        "continuous": _mean_one((
            0.80, 0.78, 0.77, 0.77, 0.80, 0.86, 0.95, 1.05, 1.12, 1.16, 1.18, 1.20,
            1.18, 1.18, 1.16, 1.12, 1.08, 1.02, 0.98, 0.94, 0.90, 0.87, 0.84, 0.82,
        )),
    },
}
# Weather-neutral HVAC fallback: occupancy-driven, same family keys.
COMPONENT_SHAPES["hvac"] = {
    "residential": COMPONENT_SHAPES["plug"]["residential"],
    "commercial": COMPONENT_SHAPES["plug"]["commercial"],
    "continuous": COMPONENT_SHAPES["plug"]["continuous"],
}

# Where electricity goes, by building shape family. Mirrors
# ewrb_profile.END_USE_SPLIT; only the lighting and HVAC shares are used here.
DEFAULT_LIGHTING_SHARE = 0.26
DEFAULT_HVAC_SHARE = 0.42


# Share of a building's plug load attributable to EV charging. EWRB reports no
# EV data at all, so unlike every other figure here this one is assumed rather
# than measured, and the payload says so.
EV_SHARE_OF_PLUG = 0.15

# Property types whose process load can genuinely be rescheduled.
DEFERRABLE_TYPES = {
    "Manufacturing/Industrial Plant",
    "Distribution Center",
    "Non-Refrigerated Warehouse",
    "Refrigerated Warehouse",
    "Self-Storage Facility",
}


class Levers:
    """The knobs the Plan page exposes, with their neutral defaults.

    Two groups that do different things. The first six change how much energy
    the district consumes over a year. The last five change only the shape of
    the peak: flexibility moves load between hours, and the comfort floors cap
    how much of it may be shed before the building stops serving its occupants.
    """

    __slots__ = (
        "heat_pump_pct", "heat_pump_cop",
        "retrofit_pct", "retrofit_target_percentile",
        "setpoint_widen_c", "lighting_retrofit_pct",
        "flex_ev_pct", "flex_hvac_pct", "flex_industrial_pct",
        "air_quality_floor_pct", "lighting_floor_pct",
    )

    def __init__(
        self,
        heat_pump_pct: float = 0.0,
        heat_pump_cop: float = DEFAULT_HEAT_PUMP_COP,
        retrofit_pct: float = 0.0,
        retrofit_target_percentile: float = 25.0,
        setpoint_widen_c: float = 0.0,
        lighting_retrofit_pct: float = 0.0,
        flex_ev_pct: float = 0.0,
        flex_hvac_pct: float = 0.0,
        flex_industrial_pct: float = 0.0,
        air_quality_floor_pct: float = 100.0,
        lighting_floor_pct: float = 100.0,
    ) -> None:
        self.heat_pump_pct = _clamp(heat_pump_pct, 0, 100)
        self.heat_pump_cop = _clamp(heat_pump_cop, 1.0, 6.0)
        self.retrofit_pct = _clamp(retrofit_pct, 0, 100)
        self.retrofit_target_percentile = _clamp(retrofit_target_percentile, 0, 100)
        self.setpoint_widen_c = _clamp(setpoint_widen_c, 0, 6)
        self.lighting_retrofit_pct = _clamp(lighting_retrofit_pct, 0, 100)
        self.flex_ev_pct = _clamp(flex_ev_pct, 0, 100)
        self.flex_hvac_pct = _clamp(flex_hvac_pct, 0, 100)
        self.flex_industrial_pct = _clamp(flex_industrial_pct, 0, 100)
        self.air_quality_floor_pct = _clamp(air_quality_floor_pct, 0, 100)
        self.lighting_floor_pct = _clamp(lighting_floor_pct, 0, 100)


# --- Weather -------------------------------------------------------------
# Degree-day base. Below this a building needs heat, above it cooling; 18 C is
# the standard base for Canadian degree-day statistics.
DEGREE_DAY_BASE_C = 18.0

# Toronto climate normals, declared. These convert a day's degree-days into a
# share of the annual total, which is the only way to get a daily figure out of
# an annual reported intensity. Replace with an Open-Meteo archive query for a
# specific year if you want them exact rather than normal.
TORONTO_ANNUAL_HDD18 = 3650.0
TORONTO_ANNUAL_CDD18 = 350.0

# How electric HVAC divides between heating, cooling and year-round fans.
ELEC_HVAC_HEATING = 0.30
ELEC_HVAC_COOLING = 0.50

# Lighting uplift when daylight is poor. Overcast and precipitation defeat
# daylight harvesting and people switch lights on earlier.
OVERCAST_LIGHTING_UPLIFT = 0.05

# Extra heating from infiltration on a windy day, per km/h above a calm 15.
WIND_INFILTRATION_PER_KMH = 0.004

# Open-Meteo WMO codes: overcast, fog, drizzle, rain, snow, showers, storms.
_OVERCAST_CODES = {3, 45, 48}


def _is_overcast(code: int | None) -> bool:
    if code is None:
        return False
    return code in _OVERCAST_CODES or code >= 51


def _is_snow(code: int | None) -> bool:
    return code is not None and (71 <= code <= 77 or 85 <= code <= 86)


def weather_day(
    profiles: list[dict[str, Any]],
    elec_mwh: float,
    gas_mwh: float,
    temp_c: float,
    weather_code: int | None = None,
    wind_kmh: float = 0.0,
    precip_mm: float = 0.0,
) -> dict[str, Any]:
    """What one forecast day costs the district, against an average day.

    Annual reported intensity says nothing about any particular day, so the
    bridge is degree-days: heating load tracks how far the day sits below 18 C,
    cooling how far above, and the day's share of the annual degree-day total
    is the share of the annual heating or cooling energy it accounts for.

    This is why rain barely registers and snow does. Precipitation itself moves
    almost no energy - its effect here is a small lighting uplift from lost
    daylight. A snowy day matters because it is a cold day, and cold is the
    single largest driver of energy use in this city.
    """
    hdd = max(0.0, DEGREE_DAY_BASE_C - temp_c)
    cdd = max(0.0, temp_c - DEGREE_DAY_BASE_C)

    # A day's share of the year, relative to an evenly spread average day.
    heat_ratio = hdd / (TORONTO_ANNUAL_HDD18 / 365.0)
    cool_ratio = cdd / (TORONTO_ANNUAL_CDD18 / 365.0)

    # Split annual energy into weather-driven and flat parts.
    hvac_share = DEFAULT_HVAC_SHARE
    elec_heating = elec_mwh * hvac_share * ELEC_HVAC_HEATING
    elec_cooling = elec_mwh * hvac_share * ELEC_HVAC_COOLING
    elec_base = elec_mwh - elec_heating - elec_cooling
    gas_heating = gas_mwh  # gas in these buildings is heating and hot water

    wind_uplift = 1.0 + max(0.0, wind_kmh - 15.0) * WIND_INFILTRATION_PER_KMH
    light_uplift = OVERCAST_LIGHTING_UPLIFT if _is_overcast(weather_code) else 0.0

    day_elec = (
        elec_base / 365.0 * (1.0 + light_uplift * DEFAULT_LIGHTING_SHARE / (1 - hvac_share))
        + elec_heating / 365.0 * heat_ratio * wind_uplift
        + elec_cooling / 365.0 * cool_ratio
    )
    day_gas = gas_heating / 365.0 * heat_ratio * wind_uplift

    avg_elec = elec_mwh / 365.0
    avg_gas = gas_mwh / 365.0
    avg_site = avg_elec + avg_gas
    day_site = day_elec + day_gas

    # Name the effect that actually moved the number, largest first. Ordering
    # matters more than it looks: a 14 C overcast day runs heating at about a
    # third of normal and lands ~38% below an average day, while the overcast
    # effect is a 5% uplift on the lighting share alone. Testing cloud before
    # mild weather credited the rounding error and ignored the cause.
    mild = 0.25 < heat_ratio < 0.75 and cool_ratio < 1.0
    overcast_note = " Overcast adds a little lighting on top." if light_uplift else ""

    if _is_snow(weather_code):
        driver = "Snow — cold is what drives this, not the snow itself"
    elif hdd > 12:
        driver = "Cold day: heating dominates"
    elif cdd > 3:
        driver = "Warm day: cooling raises electricity"
    elif mild:
        driver = (
            f"Mild day: heating runs at {heat_ratio:.0%} of normal, "
            f"which is most of the difference.{overcast_note}"
        )
    elif heat_ratio <= 0.25 and cool_ratio < 1.0:
        driver = f"Shoulder day: almost no heating or cooling.{overcast_note}"
    elif light_uplift:
        driver = "Overcast: a little more lighting, little else"
    else:
        driver = "Close to an average day"

    return {
        "available": True,
        "temp_c": round(temp_c, 1),
        "hdd": round(hdd, 1),
        "cdd": round(cdd, 1),
        "heating_vs_average": round(heat_ratio, 2),
        "cooling_vs_average": round(cool_ratio, 2),
        "day_elec_mwh": round(day_elec, 1),
        "day_gas_mwh": round(day_gas, 1),
        "day_site_mwh": round(day_site, 1),
        "day_emissions_tco2e": round(
            _emissions_t(day_elec * 1000.0, day_gas * 1000.0), 1
        ),
        "average_day_site_mwh": round(avg_site, 1),
        "vs_average_pct": round(100.0 * (day_site - avg_site) / avg_site, 1) if avg_site else None,
        "driver": driver,
        "precip_mm": round(precip_mm, 1),
        "note": (
            "Degree-days against Toronto normals of "
            f"{TORONTO_ANNUAL_HDD18:.0f} HDD and {TORONTO_ANNUAL_CDD18:.0f} CDD at "
            f"{DEGREE_DAY_BASE_C:.0f} °C. Precipitation moves almost no energy on its own; "
            "a wet day shows up mainly as lost daylight, and a snowy day as a cold one."
        ),
    }


def _normalise(values: list[float]) -> list[float]:
    """Scale to sum 1.0; an all-zero series stays all-zero."""
    total = sum(values)
    return [v / total for v in values] if total > 0 else list(values)


def _lag(values: list[float], hours: int = THERMAL_LAG_HOURS) -> list[float]:
    """Trailing mean over `hours`, wrapping at midnight.

    A building does not track the outdoor temperature instantly — mass and
    stored heat mean its load trails the weather. Without this the heating
    curve turns at exactly the same hour the thermometer does, which is
    visibly wrong on a clear cold morning.
    """
    if hours <= 0:
        return list(values)
    n = len(values)
    return [
        sum(values[(i - k) % n] for k in range(hours + 1)) / (hours + 1)
        for i in range(n)
    ]


def cop_at(temp_c: float, rated_cop: float) -> float:
    """Heat pump COP at an outdoor temperature.

    Manufacturers rate air-source heat pumps at 8.3 C (47 F). Capacity and
    efficiency both fall as it gets colder, roughly linearly over the range
    that matters here, until backup resistance heat takes over near COP 1.

    This is why the hour-by-hour view matters: the coldest hour of the day has
    both the *most* heat to deliver and the *worst* efficiency to deliver it
    with, so electricity demand rises faster than heat demand does. A flat
    seasonal COP cannot show that, and it is the whole reason winter peaks
    worry a grid operator.
    """
    return max(MIN_HEAT_PUMP_COP, rated_cop - COP_DERATE_PER_C * (COP_RATING_TEMP_C - temp_c))


def _end_use_components(profiles: list[dict[str, Any]]) -> dict[str, list[float]]:
    """Split the district's hourly electricity into HVAC, lighting and plug.

    Each building contributes its annual electricity, divided by the end-use
    split for its shape family and spread over that family's hourly profile.
    Keeping the three apart is what lets a lever change the *shape*: an LED
    retrofit shrinks the evening lighting bump without touching plug load,
    where scaling one blended curve could only move everything together.
    """
    out = {k: [0.0] * 24 for k in ("hvac", "lighting", "plug")}
    for p in profiles:
        demand = p["demand"]
        family = demand.get("shape", "commercial")
        elec = p["annual"]["elec_mwh"]
        if elec <= 0:
            continue
        shares = {
            "hvac": demand.get("hvac_share_pct", 42) / 100.0,
            "lighting": demand.get("lighting_share_pct", 26) / 100.0,
            "plug": demand.get("plug_share_pct", 32) / 100.0,
        }
        for use, share in shares.items():
            shape = COMPONENT_SHAPES[use].get(family, COMPONENT_SHAPES[use]["commercial"])
            weight = elec * share
            for h in range(24):
                out[use][h] += weight * shape[h]
    return out


def day_curves(
    profiles: list[dict[str, Any]],
    base_day_elec_mwh: float,
    plan_day_elec_mwh: float,
    shift_mw: float,
    shed_mw: float,
    hourly_temps_c: list[float] | None = None,
    levers: "Levers | None" = None,
    hp_elec_annual_mwh: float = 0.0,
    heat_ratio: float = 1.0,
) -> dict[str, Any]:
    """Hourly electricity for the selected day, before and after the plan.

    The level comes from reported energy run through the day's degree-days.
    The *shape* is composed from three end uses rather than one blended curve,
    and when hourly temperatures are supplied the HVAC part is driven by them
    directly — heating follows how far each hour sits below 18 C, cooling how
    far above. That is what lets the plan change the shape of the day and not
    merely its height.

    Heat pump electricity is placed on the heating shape and divided by the COP
    *at that hour's temperature*, so converting gas heat moves load towards the
    coldest hours, which on a Toronto winter morning is before dawn — nowhere
    near the early-evening peak the stock has today.

    Falls back to the old single-shape behaviour when no temperatures are given.
    """
    comps = _end_use_components(profiles)
    if sum(sum(c) for c in comps.values()) <= 0:
        return {"available": False}

    temps = list(hourly_temps_c) if hourly_temps_c and len(hourly_temps_c) == 24 else None

    # --- Thermal shapes, from the actual temperature profile ---------------
    heat_shape: list[float] | None = None
    cool_shape: list[float] | None = None
    if temps:
        raw_heat = _lag([max(0.0, DEGREE_DAY_BASE_C - t) for t in temps])
        raw_cool = _lag([max(0.0, t - DEGREE_DAY_BASE_C) for t in temps])
        heat_shape = _normalise(raw_heat) if sum(raw_heat) > 0 else None
        cool_shape = _normalise(raw_cool) if sum(raw_cool) > 0 else None

    def hvac_split(total_by_hour: list[float]) -> list[float]:
        """Re-lay the HVAC component onto heating/cooling/ventilation shapes."""
        total = sum(total_by_hour)
        if total <= 0 or not temps:
            return list(total_by_hour)
        vent_share = max(0.0, 1.0 - ELEC_HVAC_HEATING - ELEC_HVAC_COOLING)
        vent = _normalise(total_by_hour)
        out = [0.0] * 24
        for h in range(24):
            out[h] += total * vent_share * vent[h]
            # With no heating (or cooling) demand on the day, that portion
            # stays on the occupancy shape rather than vanishing.
            out[h] += total * ELEC_HVAC_HEATING * (heat_shape[h] if heat_shape else vent[h])
            out[h] += total * ELEC_HVAC_COOLING * (cool_shape[h] if cool_shape else vent[h])
        return out

    base_by_hour = [
        hvac_split(comps["hvac"])[h] + comps["lighting"][h] + comps["plug"][h]
        for h in range(24)
    ]
    base_norm = _normalise(base_by_hour)
    base = [v * base_day_elec_mwh for v in base_norm]

    # --- The planned shape: levers act on the component they actually touch -
    lighting_factor = 1.0
    hvac_factor = 1.0
    if levers is not None:
        lighting_factor = 1.0 - (levers.lighting_retrofit_pct / 100.0) * LIGHTING_RETROFIT_SAVING
        hvac_factor = max(
            0.0, 1.0 - levers.setpoint_widen_c * HEATING_SAVING_PER_C
        )

    hvac_planned = [v * hvac_factor for v in hvac_split(comps["hvac"])]
    plan_by_hour = [
        hvac_planned[h] + comps["lighting"][h] * lighting_factor + comps["plug"][h]
        for h in range(24)
    ]

    # Heat pump load is its own series: heating demand divided by the COP that
    # hour's temperature actually allows.
    hp_curve = [0.0] * 24
    hp_flat_mwh = max(0.0, hp_elec_annual_mwh / 365.0 * heat_ratio)
    cop_penalty_mwh = 0.0
    effective_cop: float | None = None
    rated = levers.heat_pump_cop if levers is not None else DEFAULT_HEAT_PUMP_COP

    if hp_flat_mwh > 0 and temps and heat_shape:
        heat_total = hp_flat_mwh * rated  # Heat to deliver, held fixed.
        for h in range(24):
            delivered = heat_total * heat_shape[h]
            hp_curve[h] = delivered / cop_at(temps[h], rated)
        hp_actual = sum(hp_curve)
        cop_penalty_mwh = hp_actual - hp_flat_mwh
        effective_cop = heat_total / hp_actual if hp_actual > 0 else None
    elif hp_flat_mwh > 0:
        # No temperature profile: fall back to flat COP on the blended shape.
        spread = _normalise(plan_by_hour)
        hp_curve = [hp_flat_mwh * s for s in spread]

    # Everything that is not heat pump load is scaled to the planned day total.
    other_total = max(0.0, plan_day_elec_mwh - hp_flat_mwh)
    other = [v * other_total for v in _normalise(plan_by_hour)]
    plan = [other[h] + hp_curve[h] for h in range(24)]

    # --- Dispatch: shed is removed outright, shifted load is moved ----------
    order_busy = sorted(range(24), key=lambda i: -plan[i])
    order_quiet = sorted(range(24), key=lambda i: plan[i])
    peak_hours = order_busy[:4]
    trough_hours = order_quiet[:4]

    for h in peak_hours:
        plan[h] = max(0.0, plan[h] - (shed_mw + shift_mw) / len(peak_hours))
    for h in trough_hours:
        plan[h] += shift_mw / len(trough_hours)

    base_peak_h = max(range(24), key=lambda i: base[i])
    plan_peak_h = max(range(24), key=lambda i: plan[i])

    if temps and heat_shape and hp_flat_mwh > 0:
        note = (
            f"HVAC follows the day's hourly temperature; heat pump load is divided by the "
            f"COP each hour allows (effective {effective_cop:.2f} against {rated:.1f} rated). "
            f"Peak moves {base_peak_h:02d}:00 to {plan_peak_h:02d}:00."
        )
    elif temps:
        note = (
            "HVAC follows the day's hourly temperature, lighting and plug load their own "
            "profiles. Shed load is removed; shifted load moves from the four busiest "
            "hours into the four quietest."
        )
    else:
        note = (
            "No hourly temperatures for this day, so HVAC keeps its typical profile and "
            "only the level responds to the weather."
        )

    return {
        "available": True,
        "hours": list(range(24)),
        "baseline_mw": [round(v, 2) for v in base],
        "planned_mw": [round(v, 2) for v in plan],
        "baseline_peak_mw": round(max(base), 2),
        "planned_peak_mw": round(max(plan), 2),
        "baseline_peak_hour": base_peak_h,
        "planned_peak_hour": plan_peak_h,
        "planned_day_elec_mwh": round(sum(plan), 1),
        "weather_driven": bool(temps),
        "heat_pump_day_mwh": round(sum(hp_curve), 1),
        "cop_penalty_mwh": round(cop_penalty_mwh, 1),
        "effective_cop": round(effective_cop, 2) if effective_cop else None,
        "rated_cop": round(rated, 1),
        "note": note,
    }


def peak_response(
    profiles: list[dict[str, Any]],
    levers: Levers,
    elec_scale: float,
) -> dict[str, Any]:
    """District peak before and after flexibility, bounded by the comfort floors.

    Separate from the energy levers on purpose. Shifting load and shedding it
    change *when* electricity is drawn, not how much: the annual total is set by
    the consumption levers, and this reports what the dispatch does to the worst
    hour of it.

    `elec_scale` carries the consumption levers through, so electrifying heat
    raises the peak these actions have to work against.
    """
    curve = [0.0] * 24
    for p in profiles:
        for i, v in enumerate(p["demand"]["curve_kw"]):
            curve[i] += v * elec_scale
    if not any(curve):
        return {"available": False}

    hour = max(range(24), key=lambda i: curve[i])
    peak_kw = curve[hour]

    # What each end use contributes at that hour.
    hvac_kw = ev_kw = deferrable_kw = lighting_kw = 0.0
    for p in profiles:
        at_peak = p["demand"]["curve_kw"][hour] * elec_scale
        hvac_kw += at_peak * p["demand"]["hvac_share_pct"] / 100.0
        lighting_kw += at_peak * p["demand"]["lighting_share_pct"] / 100.0
        plug = at_peak * p["demand"]["plug_share_pct"] / 100.0
        ev_kw += plug * EV_SHARE_OF_PLUG
        if p["property_type"] in DEFERRABLE_TYPES:
            deferrable_kw += plug

    # Comfort floors are headroom: a 88% air-quality floor permits shedding 12%
    # of ventilation, and nothing beyond it.
    vent_headroom = 1.0 - levers.air_quality_floor_pct / 100.0
    light_headroom = 1.0 - levers.lighting_floor_pct / 100.0

    shed_hvac = hvac_kw * vent_headroom * (levers.flex_hvac_pct / 100.0)
    shed_light = lighting_kw * light_headroom
    shift_ev = ev_kw * (levers.flex_ev_pct / 100.0)
    shift_ind = deferrable_kw * (levers.flex_industrial_pct / 100.0)

    reduction = shed_hvac + shed_light + shift_ev + shift_ind
    reduction = min(reduction, peak_kw * 0.6)  # a district cannot shed itself away

    return {
        "available": True,
        "peak_hour": hour,
        "baseline_peak_mw": round(peak_kw / 1000.0, 2),
        "planned_peak_mw": round((peak_kw - reduction) / 1000.0, 2),
        "reduction_mw": round(reduction / 1000.0, 2),
        "reduction_pct": round(100.0 * reduction / peak_kw, 1) if peak_kw else 0.0,
        "actions": [
            {
                "action": "shift_ev",
                "label": "Flexible EV charging",
                "mw": round(shift_ev / 1000.0, 2),
                "kind": "shifted",
                "detail": (
                    f"{levers.flex_ev_pct:.0f}% of EV load, assumed at "
                    f"{EV_SHARE_OF_PLUG * 100:.0f}% of plug load"
                ),
            },
            {
                "action": "precool",
                "label": "HVAC pre-cooling",
                "mw": round(shed_hvac / 1000.0, 2),
                "kind": "shifted",
                "detail": (
                    f"{levers.flex_hvac_pct:.0f}% of HVAC, capped at "
                    f"{vent_headroom * 100:.0f}% by the air-quality floor"
                ),
            },
            {
                "action": "dim_lighting",
                "label": "Lighting dimming",
                "mw": round(shed_light / 1000.0, 2),
                "kind": "shed",
                "detail": f"{light_headroom * 100:.0f}% headroom under the lighting floor",
            },
            {
                "action": "defer_industrial",
                "label": "Deferrable industrial",
                "mw": round(shift_ind / 1000.0, 2),
                "kind": "shifted",
                "detail": f"{levers.flex_industrial_pct:.0f}% of deferrable process load",
            },
        ],
        "note": (
            "Shifted load returns in another hour and does not reduce annual energy; "
            "only the shed share is avoided outright."
        ),
    }


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _emissions_t(elec_kwh: float, gas_kwh: float) -> float:
    return (elec_kwh * ELEC_KG_PER_KWH + gas_kwh * GAS_KG_PER_KWH) / 1000.0


def apply_levers(
    profiles: list[dict[str, Any]],
    levers: Levers,
    day: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the levers over per-building profiles and report what changed.

    Order matters and is fixed: efficiency first, then the envelope setpoint,
    then lighting, then electrification of whatever gas is left. Running
    electrification first would credit it with heat that the retrofit was going
    to remove anyway, double counting the saving.

    Each lever's contribution is measured as the energy delta it alone caused at
    its point in the sequence, so the parts sum to the whole.
    """
    base_elec = sum(p["annual"]["elec_mwh"] for p in profiles) * 1000.0
    base_gas = sum(p["annual"]["gas_mwh"] for p in profiles) * 1000.0

    elec = base_elec
    gas = base_gas
    breakdown: list[dict[str, Any]] = []

    def record(name: str, label: str, d_elec: float, d_gas: float, detail: str) -> None:
        breakdown.append(
            {
                "lever": name,
                "label": label,
                "delta_elec_mwh": round(d_elec / 1000.0, 1),
                "delta_gas_mwh": round(d_gas / 1000.0, 1),
                "delta_site_mwh": round((d_elec + d_gas) / 1000.0, 1),
                "delta_tco2e": round(
                    _emissions_t(elec + d_elec, gas + d_gas) - _emissions_t(elec, gas), 1
                ),
                "detail": detail,
            }
        )

    # --- 1. Efficiency retrofit to a percentile the cohort already reports ---
    if levers.retrofit_pct > 0:
        share = levers.retrofit_pct / 100.0
        saved_elec = saved_gas = 0.0
        touched = 0
        for p in profiles:
            current = p["intensity"]["site_eui_kwh_m2"]
            bench = p["benchmark"]
            target = (
                bench.get("cohort_p25_site_eui")
                if levers.retrofit_target_percentile <= 25
                else bench.get("cohort_median_site_eui")
            )
            if current is None or target is None or current <= target:
                continue
            touched += 1
            # Both fuels fall together: the retrofit cuts demand, not fuel choice.
            factor = (1.0 - target / current) * share
            saved_elec += p["annual"]["elec_mwh"] * 1000.0 * factor
            saved_gas += p["annual"]["gas_mwh"] * 1000.0 * factor
        record(
            "retrofit",
            "Efficiency retrofit",
            -saved_elec,
            -saved_gas,
            f"{touched} buildings above the target, {levers.retrofit_pct:.0f}% of them upgraded",
        )
        elec -= saved_elec
        gas -= saved_gas

    # --- 2. Setpoint: fewer degree-days to serve --------------------------
    if levers.setpoint_widen_c > 0:
        frac = min(0.4, levers.setpoint_widen_c * HEATING_SAVING_PER_C)
        # Gas is overwhelmingly heating; only the HVAC slice of electricity is.
        d_gas = -gas * frac
        d_elec = -elec * DEFAULT_HVAC_SHARE * frac
        record(
            "setpoint",
            "Wider comfort band",
            d_elec,
            d_gas,
            f"{levers.setpoint_widen_c:.1f} °C wider, {HEATING_SAVING_PER_C * 100:.0f}% heating per °C",
        )
        elec += d_elec
        gas += d_gas

    # --- 3. Lighting retrofit --------------------------------------------
    if levers.lighting_retrofit_pct > 0:
        frac = (
            DEFAULT_LIGHTING_SHARE
            * LIGHTING_RETROFIT_SAVING
            * (levers.lighting_retrofit_pct / 100.0)
        )
        d_elec = -elec * frac
        record(
            "lighting",
            "LED lighting",
            d_elec,
            0.0,
            f"{levers.lighting_retrofit_pct:.0f}% of floor area, "
            f"{LIGHTING_RETROFIT_SAVING * 100:.0f}% of lighting load",
        )
        elec += d_elec

    # --- 4. Electrify what heating is left --------------------------------
    hp_elec_mwh = 0.0
    if levers.heat_pump_pct > 0 and gas > 0:
        converted_gas = gas * (levers.heat_pump_pct / 100.0)
        heat_delivered = converted_gas * BOILER_EFFICIENCY
        elec_needed = heat_delivered / levers.heat_pump_cop
        record(
            "heat_pump",
            "Heat pump conversion",
            elec_needed,
            -converted_gas,
            f"{levers.heat_pump_pct:.0f}% of remaining gas heat at COP {levers.heat_pump_cop:.1f}",
        )
        gas -= converted_gas
        elec += elec_needed
        # Kept for the hourly curve: this is the only load whose efficiency
        # depends on the outdoor temperature, so it is placed separately.
        hp_elec_mwh = elec_needed

    _peak = peak_response(profiles, levers, (elec / base_elec) if base_elec else 1.0)

    _weather = (
        weather_day(
            profiles,
            elec / 1000.0,
            gas / 1000.0,
            temp_c=float(day["temp_c"]),
            weather_code=day.get("weather_code"),
            wind_kmh=float(day.get("wind_kmh") or 0.0),
            precip_mm=float(day.get("precip_mm") or 0.0),
        )
        if day and day.get("temp_c") is not None
        else {"available": False}
    )

    # The chart needs the day at both ends: the same weather applied to the
    # untouched stock, and to the planned stock.
    if _weather.get("available"):
        _base_weather = weather_day(
            profiles,
            base_elec / 1000.0,
            base_gas / 1000.0,
            temp_c=float(day["temp_c"]),
            weather_code=day.get("weather_code"),
            wind_kmh=float(day.get("wind_kmh") or 0.0),
            precip_mm=float(day.get("precip_mm") or 0.0),
        )
        _curve = day_curves(
            profiles,
            _base_weather["day_elec_mwh"],
            _weather["day_elec_mwh"],
            shift_mw=sum(
                a["mw"] for a in _peak.get("actions", []) if a["kind"] == "shifted"
            ),
            shed_mw=sum(a["mw"] for a in _peak.get("actions", []) if a["kind"] == "shed"),
            hourly_temps_c=day.get("hourly_temps_c"),
            levers=levers,
            # apply_levers works in kWh; the curve works in MWh.
            hp_elec_annual_mwh=hp_elec_mwh / 1000.0,
            heat_ratio=_weather.get("heating_vs_average", 1.0),
        )
        _weather["baseline_day_site_mwh"] = _base_weather["day_site_mwh"]
        _weather["baseline_day_emissions_tco2e"] = _base_weather["day_emissions_tco2e"]

        # The annual maths divides heat by one seasonal COP. The hourly curve
        # divides it by the COP each hour's temperature actually allows, and on
        # a cold day that is a great deal worse. Fold the difference back into
        # the day's figures, or the chart and the stat cards would disagree --
        # and the chart is the one telling the truth about this day.
        _penalty = _curve.get("cop_penalty_mwh", 0.0) or 0.0
        if _penalty:
            _weather["day_elec_mwh"] = round(_weather["day_elec_mwh"] + _penalty, 1)
            _weather["day_site_mwh"] = round(_weather["day_site_mwh"] + _penalty, 1)
            _weather["day_emissions_tco2e"] = round(
                _emissions_t(
                    _weather["day_elec_mwh"] * 1000.0, _weather["day_gas_mwh"] * 1000.0
                ),
                1,
            )
            _weather["cop_penalty_mwh"] = round(_penalty, 1)
            _weather["note"] = (
                _weather.get("note", "")
                + f" Includes {_penalty:,.0f} MWh of extra heat pump electricity: "
                f"COP falls to {_curve.get('effective_cop')} at this day's temperatures, "
                f"against {_curve.get('rated_cop')} rated."
            ).strip()
    else:
        _curve = {"available": False}

    base_site = base_elec + base_gas
    site = elec + gas
    base_t = _emissions_t(base_elec, base_gas)
    plan_t = _emissions_t(elec, gas)

    return {
        "baseline": {
            "elec_mwh": round(base_elec / 1000.0, 1),
            "gas_mwh": round(base_gas / 1000.0, 1),
            "site_mwh": round(base_site / 1000.0, 1),
            "emissions_tco2e": round(base_t, 1),
            "electrified_pct": round(100.0 * base_elec / base_site, 1) if base_site else None,
        },
        "planned": {
            "elec_mwh": round(elec / 1000.0, 1),
            "gas_mwh": round(gas / 1000.0, 1),
            "site_mwh": round(site / 1000.0, 1),
            "emissions_tco2e": round(plan_t, 1),
            "electrified_pct": round(100.0 * elec / site, 1) if site else None,
        },
        "change": {
            "site_mwh": round((site - base_site) / 1000.0, 1),
            "site_pct": round(100.0 * (site - base_site) / base_site, 1) if base_site else None,
            "elec_mwh": round((elec - base_elec) / 1000.0, 1),
            "elec_pct": round(100.0 * (elec - base_elec) / base_elec, 1) if base_elec else None,
            "gas_mwh": round((gas - base_gas) / 1000.0, 1),
            "gas_pct": round(100.0 * (gas - base_gas) / base_gas, 1) if base_gas else None,
            "emissions_tco2e": round(plan_t - base_t, 1),
            "emissions_pct": round(100.0 * (plan_t - base_t) / base_t, 1) if base_t else None,
        },
        "breakdown": breakdown,
        "weather": _weather,
        "peak": _peak,
        "day_curve": _curve,
        "factors": {
            "elec_kg_per_kwh": ELEC_KG_PER_KWH,
            "gas_kg_per_kwh": GAS_KG_PER_KWH,
            "source": (
                "Least-squares fit of reported GHG against reported electricity and gas "
                "intensity over 5,606 EWRB filings; 6% median error."
            ),
        },
        "assumptions": {
            "boiler_efficiency": BOILER_EFFICIENCY,
            "heat_pump_cop": levers.heat_pump_cop,
            "heating_saving_per_c": HEATING_SAVING_PER_C,
            "lighting_share": DEFAULT_LIGHTING_SHARE,
            "lighting_retrofit_saving": LIGHTING_RETROFIT_SAVING,
            "hvac_share": DEFAULT_HVAC_SHARE,
            "order": "retrofit, setpoint, lighting, electrification",
        },
    }
