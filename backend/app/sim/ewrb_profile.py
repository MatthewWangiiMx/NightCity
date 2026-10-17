"""Turn a massing footprint plus an EWRB cohort into a building energy profile.

Division of labour, and it matters for how the UI labels things:

  * `app/data/ewrb.py` holds *reported* figures - annual intensities that real
    operators filed with the province. Nothing there is modelled.
  * this module *derives* a profile from them. Annual totals are the reported
    intensity times the building's floor area, so they inherit the measurement.
    Anything sub-annual - a demand curve, a peak, an HVAC split - is modelled
    from the assumptions declared below, because EWRB reports yearly totals and
    says nothing about shape.

Every payload carries a `provenance` block so a panel can draw the line between
the two without guessing.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

from app.data import ewrb

# --- Declared assumptions (modelled, not reported) ------------------------
# Annual load factor: average electrical demand / peak demand. Property types
# with round-the-clock base load sit higher; single-shift types lower.
LOAD_FACTOR: dict[str, float] = {
    "Multifamily Housing": 0.62,
    "Office": 0.48,
    "Hotel": 0.60,
    "Retail Store": 0.52,
    "Strip Mall": 0.50,
    "Enclosed Mall": 0.55,
    "Manufacturing/Industrial Plant": 0.65,
    "Non-Refrigerated Warehouse": 0.45,
    "Distribution Center": 0.58,
    "Ice/Curling Rink": 0.55,
    "Indoor Arena": 0.42,
    "Stadium (Open)": 0.35,
    "Transit Station": 0.70,
    "Other - Public Services": 0.50,
    "Courthouse": 0.45,
    "Library": 0.45,
    "Fitness Center/Health Club/Gym": 0.52,
}
DEFAULT_LOAD_FACTOR = 0.50

# Normalised diurnal electricity shape, 24 hourly multipliers of average demand.
# Residential peaks in the evening; commercial through the working day.
DIURNAL_SHAPES: dict[str, tuple[float, ...]] = {
    "residential": (
        0.72, 0.66, 0.62, 0.60, 0.61, 0.68, 0.84, 0.96, 0.98, 0.94, 0.90, 0.89,
        0.90, 0.90, 0.92, 0.98, 1.12, 1.30, 1.42, 1.44, 1.36, 1.20, 1.02, 0.84,
    ),
    "commercial": (
        0.55, 0.52, 0.51, 0.51, 0.54, 0.64, 0.82, 1.06, 1.26, 1.36, 1.40, 1.42,
        1.41, 1.42, 1.40, 1.34, 1.22, 1.04, 0.86, 0.74, 0.67, 0.63, 0.60, 0.57,
    ),
    "continuous": (
        0.88, 0.86, 0.85, 0.85, 0.86, 0.90, 0.98, 1.06, 1.10, 1.12, 1.13, 1.14,
        1.13, 1.13, 1.12, 1.10, 1.08, 1.04, 1.00, 0.97, 0.95, 0.93, 0.91, 0.89,
    ),
}

SHAPE_BY_TYPE: dict[str, str] = {
    "Multifamily Housing": "residential",
    "Other - Lodging/Residential": "residential",
    "Hotel": "continuous",
    "Office": "commercial",
    "Retail Store": "commercial",
    "Strip Mall": "commercial",
    "Enclosed Mall": "commercial",
    "Courthouse": "commercial",
    "Library": "commercial",
    "Manufacturing/Industrial Plant": "continuous",
    "Distribution Center": "continuous",
    "Non-Refrigerated Warehouse": "commercial",
    "Transit Station": "continuous",
    "Ice/Curling Rink": "continuous",
    "Indoor Arena": "commercial",
    "Stadium (Open)": "commercial",
}
DEFAULT_SHAPE = "commercial"

# End-use split of *electricity*, by shape family. Gas is reported separately,
# so a gas-heated building's space heating does not appear in these shares.
END_USE_SPLIT: dict[str, dict[str, int]] = {
    "residential": {"hvac": 32, "lighting": 18, "plug": 50},
    "commercial": {"hvac": 44, "lighting": 26, "plug": 30},
    "continuous": {"hvac": 40, "lighting": 22, "plug": 38},
}

# Flexibility: share of electrical peak the optimizer may shift or shed, by
# shape family. Comfort stays a hard constraint on top of this.
FLEX_SHARE: dict[str, float] = {
    "residential": 0.10,
    "commercial": 0.22,
    "continuous": 0.14,
}

TYPICAL_FLOOR_M = 3.2
HOURS_PER_YEAR = 8760.0

# Cap on floors *inferred* from height. Height alone cannot tell occupied storeys
# from a spire or an antenna: the CN Tower's 553 m divided by a storey height
# implies 173 floors of leasable area, which would put its energy use an order
# of magnitude above any real Toronto building. Toronto's tallest occupied tower
# is around 80 storeys, so that is the ceiling for an estimate. A floor count
# reported in the massing data is always used as-is, however tall.
MAX_ESTIMATED_FLOORS = 80

# Share of footprint that is conditioned floor area on an inferred-floors
# building. Tapering towers, atria and plant floors mean the prism implied by
# footprint x storeys overstates the real envelope.
ESTIMATED_FLOOR_EFFICIENCY = 0.82


def _stable_quantile(key: str) -> float:
    """A building's fixed position in its cohort, from a hash of its identity.

    Deterministic so a building reads the same on every load, and spread evenly
    so a district shows the real range of reported performance rather than the
    cohort median repeated hundreds of times.
    """
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def _gfa_m2(
    footprint_m2: float, levels: int | None, height_m: float | None
) -> tuple[float, int, bool]:
    """Gross floor area, the floor count used, and whether it was inferred."""
    if levels and levels > 0:
        return max(40.0, footprint_m2) * levels, int(levels), False

    floors = max(1, round((height_m or TYPICAL_FLOOR_M) / TYPICAL_FLOOR_M))
    floors = min(floors, MAX_ESTIMATED_FLOORS)
    gfa = max(40.0, footprint_m2) * floors * ESTIMATED_FLOOR_EFFICIENCY
    return gfa, floors, True


def build_profile(
    *,
    building_id: str,
    name: str,
    kind: str | None,
    footprint_m2: float,
    height_m: float | None = None,
    levels: int | None = None,
    lat: float | None = None,
    lon: float | None = None,
    fsa: str | None = None,
    city: str = "Toronto",
    hour: int | None = None,
) -> dict[str, Any] | None:
    """Reported-intensity energy profile for one massing building.

    Returns None when the dataset has no usable cohort for this kind, so the
    caller can fall back to its own estimate rather than show a fabricated one.
    """
    if fsa is None and lat is not None and lon is not None:
        fsa = ewrb.nearest_fsa(lat, lon)

    resolved = ewrb.resolve_property_type(kind, fsa=fsa, city=city)
    if resolved is None:
        return None
    property_type, cohort = resolved

    quantile = _stable_quantile(building_id)
    picked = ewrb.representative_row(property_type, quantile, fsa=fsa, city=city)
    if picked is None:
        return None
    row, scope, basis, ranked_n = picked

    # A row can pass the site-EUI screen and still carry one impossible field,
    # so every value is checked against its own metric's range before use.
    def reported(metric: str) -> float | None:
        value = getattr(row, metric, None)
        return value if ewrb.is_plausible(metric, value) else None

    gfa, floor_count, floors_estimated = _gfa_m2(footprint_m2, levels, height_m)
    shape_key = SHAPE_BY_TYPE.get(property_type, DEFAULT_SHAPE)
    shape = DIURNAL_SHAPES[shape_key]
    load_factor = LOAD_FACTOR.get(property_type, DEFAULT_LOAD_FACTOR)

    # --- Annual totals: reported intensity x this building's floor area ---
    elec_kwh_m2 = reported("elec_kwh_m2")
    gas_kwh_m2 = reported("gas_kwh_m2")
    site_eui = reported("site_eui_kwh_m2") or 0.0
    # Where electricity is withheld but site energy is not, treat the cohort's
    # median electrification share as the split rather than dropping the row.
    if elec_kwh_m2 is None:
        median_elec = (cohort["metrics"].get("elec_kwh_m2") or {}).get("median")
        median_site = (cohort["metrics"].get("site_eui_kwh_m2") or {}).get("median")
        share = (median_elec / median_site) if median_elec and median_site else 0.6
        elec_kwh_m2 = site_eui * share

    annual_elec_kwh = elec_kwh_m2 * gfa
    annual_gas_kwh = (gas_kwh_m2 or 0.0) * gfa
    annual_site_kwh = site_eui * gfa if site_eui else annual_elec_kwh + annual_gas_kwh

    # --- Electrical demand: modelled shape over the reported annual total ---
    avg_kw = annual_elec_kwh / HOURS_PER_YEAR
    peak_kw = avg_kw / load_factor
    at_hour = hour if hour is not None else 18
    demand_kw = avg_kw * shape[at_hour % 24]

    split = END_USE_SPLIT[shape_key]
    flex_kw = peak_kw * FLEX_SHARE[shape_key]

    ghg_kg_m2 = reported("ghg_kg_m2")
    water_m3_m2 = reported("water_m3_m2")
    source_eui = reported("source_eui_kwh_m2")
    star_score = reported("energy_star_score")

    ghg_t = ((ghg_kg_m2 or 0.0) * gfa) / 1000.0
    water_m3 = (water_m3_m2 or 0.0) * gfa

    eui_rank = (
        ewrb.percentile_rank(property_type, "site_eui_kwh_m2", site_eui) if site_eui else None
    )
    ghg_rank = (
        ewrb.percentile_rank(property_type, "ghg_kg_m2", ghg_kg_m2)
        if ghg_kg_m2 is not None
        else None
    )
    # Recomputed from the screened fields, so a dropped gas line cannot read as
    # fully electric.
    electrification = (
        round(min(100.0, 100.0 * elec_kwh_m2 / site_eui), 1)
        if site_eui > 0 and elec_kwh_m2 is not None
        else None
    )

    return {
        "building_id": building_id,
        "name": name,
        "kind": kind,
        "property_type": property_type,
        "fsa": fsa,
        "city": city,
        # Geometry
        "footprint_m2": round(footprint_m2, 1),
        "levels": floor_count,
        "floors_estimated": floors_estimated,
        "height_m": round(height_m, 1) if height_m else None,
        "gross_floor_area_m2": round(gfa),
        # Reported intensities (measured)
        "intensity": {
            "elec_kwh_m2": round(elec_kwh_m2, 1),
            "gas_kwh_m2": round(gas_kwh_m2, 1) if gas_kwh_m2 is not None else None,
            "site_eui_kwh_m2": round(site_eui, 1) if site_eui else None,
            "source_eui_kwh_m2": round(source_eui, 1) if source_eui is not None else None,
            "ghg_kg_m2": round(ghg_kg_m2, 1) if ghg_kg_m2 is not None else None,
            "water_m3_m2": round(water_m3_m2, 3) if water_m3_m2 is not None else None,
            "energy_star_score": int(star_score) if star_score is not None else None,
            "electrification_pct": electrification,
        },
        # Annual totals (reported intensity x area)
        "annual": {
            "elec_mwh": round(annual_elec_kwh / 1000.0, 1),
            "gas_mwh": round(annual_gas_kwh / 1000.0, 1),
            "site_energy_mwh": round(annual_site_kwh / 1000.0, 1),
            "emissions_tco2e": round(ghg_t, 1),
            "water_m3": round(water_m3),
        },
        # Electrical demand (modelled shape)
        "demand": {
            "avg_kw": round(avg_kw, 1),
            "peak_kw": round(peak_kw, 1),
            "demand_kw": round(demand_kw, 1),
            "at_hour": at_hour % 24,
            "load_factor_pct": round(load_factor * 100),
            "flexible_kw": round(flex_kw, 1),
            "shape": shape_key,
            "curve_kw": [round(avg_kw * m, 1) for m in shape],
            "hvac_share_pct": split["hvac"],
            "lighting_share_pct": split["lighting"],
            "plug_share_pct": split["plug"],
        },
        # Where this building sits against its cohort
        "benchmark": {
            "scope": scope,
            "basis": basis,
            "sample_size": cohort["sample_size"],
            "ranked_sample": ranked_n,
            "assigned_percentile": round(quantile * 100, 1),
            "site_eui_percentile": eui_rank,
            "ghg_percentile": ghg_rank,
            "cohort_median_site_eui": (
                cohort["metrics"].get("site_eui_kwh_m2", {}).get("median")
            ),
            "cohort_p25_site_eui": cohort["metrics"].get("site_eui_kwh_m2", {}).get("p25"),
            "cohort_p75_site_eui": cohort["metrics"].get("site_eui_kwh_m2", {}).get("p75"),
            # p05/p95 rather than min/max: one legitimate extreme in a small
            # cohort would otherwise squash the whole strip the UI draws.
            "cohort_min_site_eui": cohort["metrics"].get("site_eui_kwh_m2", {}).get("p05"),
            "cohort_max_site_eui": cohort["metrics"].get("site_eui_kwh_m2", {}).get("p95"),
            "cohort_excluded_filings": (
                cohort["metrics"].get("site_eui_kwh_m2", {}).get("excluded", 0)
            ),
            "comparable_ewrb_id": row.ewrb_id,
            "comparable_certification": row.certification,
            "data_quality_checked": row.data_quality_checked,
        },
        "provenance": {
            "measured": (
                "Annual energy, water and emissions intensity as reported to Ontario EWRB "
                f"by a comparable {property_type.lower()} property ({scope})."
            ),
            "modelled": (
                "Floor area from City of Toronto 3D Massing"
                + (
                    f", over {floor_count} storeys inferred from height"
                    f"{' (capped)' if floor_count >= MAX_ESTIMATED_FLOORS else ''}"
                    if floors_estimated
                    else f", over {floor_count} reported storeys"
                )
                + ". Demand curve, peak, end-use split and flexible share are modelled "
                "from the declared assumptions in app/sim/ewrb_profile.py - EWRB reports "
                "annual totals only."
            ),
            "caveat": (
                "EWRB rows carry no coordinates, so this is a cohort comparable, not this "
                "building's own meter."
            ),
        },
    }


def district_rollup(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate per-building profiles into district totals for Simulate/Plan."""
    if not profiles:
        return {
            "buildings": 0,
            "gross_floor_area_m2": 0,
            "annual": {"elec_mwh": 0, "gas_mwh": 0, "emissions_tco2e": 0, "water_m3": 0},
            "demand": {"peak_mw": 0, "avg_mw": 0, "flexible_mw": 0, "curve_mw": [0.0] * 24},
        }

    gfa = sum(p["gross_floor_area_m2"] for p in profiles)
    elec = sum(p["annual"]["elec_mwh"] for p in profiles)
    gas = sum(p["annual"]["gas_mwh"] for p in profiles)
    ghg = sum(p["annual"]["emissions_tco2e"] for p in profiles)
    water = sum(p["annual"]["water_m3"] for p in profiles)

    curve_kw = [0.0] * 24
    for profile in profiles:
        for i, value in enumerate(profile["demand"]["curve_kw"]):
            curve_kw[i] += value

    # Coincident peak: the district peak is the top of the summed curve, which is
    # lower than the sum of individual peaks because the types peak at
    # different hours. That diversity is the point of aggregating.
    coincident_peak_kw = max(curve_kw) if curve_kw else 0.0
    non_coincident_kw = sum(p["demand"]["peak_kw"] for p in profiles)
    flexible_kw = sum(p["demand"]["flexible_kw"] for p in profiles)

    eui_values = [
        p["intensity"]["site_eui_kwh_m2"]
        for p in profiles
        if p["intensity"]["site_eui_kwh_m2"] is not None
    ]
    scores = [
        p["intensity"]["energy_star_score"]
        for p in profiles
        if p["intensity"]["energy_star_score"] is not None
    ]

    return {
        "buildings": len(profiles),
        "gross_floor_area_m2": round(gfa),
        "annual": {
            "elec_mwh": round(elec, 1),
            "gas_mwh": round(gas, 1),
            "site_energy_mwh": round(elec + gas, 1),
            "emissions_tco2e": round(ghg, 1),
            "water_m3": round(water),
        },
        "demand": {
            "peak_mw": round(coincident_peak_kw / 1000.0, 2),
            "non_coincident_peak_mw": round(non_coincident_kw / 1000.0, 2),
            "diversity_factor": (
                round(coincident_peak_kw / non_coincident_kw, 3) if non_coincident_kw else None
            ),
            "avg_mw": round(sum(curve_kw) / 24.0 / 1000.0, 2),
            "flexible_mw": round(flexible_kw / 1000.0, 2),
            "curve_mw": [round(v / 1000.0, 3) for v in curve_kw],
        },
        "intensity": {
            "mean_site_eui_kwh_m2": (
                round(sum(eui_values) / len(eui_values), 1) if eui_values else None
            ),
            "area_weighted_ghg_kg_m2": round(ghg * 1000.0 / gfa, 1) if gfa else None,
            "mean_energy_star_score": round(sum(scores) / len(scores)) if scores else None,
            "scored_buildings": len(scores),
        },
    }


def peak_hour(profiles: list[dict[str, Any]]) -> int | None:
    """Hour of the district's coincident electrical peak."""
    if not profiles:
        return None
    curve = [0.0] * 24
    for profile in profiles:
        for i, value in enumerate(profile["demand"]["curve_kw"]):
            curve[i] += value
    return max(range(24), key=lambda i: curve[i])


def retrofit_potential(profiles: list[dict[str, Any]], target_percentile: float = 25.0) -> dict[str, Any]:
    """What the district saves if its worst performers reach a reported target.

    The target is a real percentile of each building's own cohort, so the saving
    is bounded by what comparable Ontario buildings already achieve - not by an
    arbitrary efficiency factor.
    """
    savings_mwh = 0.0
    savings_t = 0.0
    candidates: list[dict[str, Any]] = []

    for profile in profiles:
        bench = profile["benchmark"]
        current = profile["intensity"]["site_eui_kwh_m2"]
        target = bench.get("cohort_p25_site_eui") if target_percentile <= 25 else bench.get(
            "cohort_median_site_eui"
        )
        if current is None or target is None or current <= target:
            continue
        gfa = profile["gross_floor_area_m2"]
        delta_kwh = (current - target) * gfa
        ghg_rate = profile["intensity"]["ghg_kg_m2"] or 0.0
        delta_t = (ghg_rate * gfa * (1 - target / current)) / 1000.0
        savings_mwh += delta_kwh / 1000.0
        savings_t += delta_t
        candidates.append(
            {
                "building_id": profile["building_id"],
                "name": profile["name"],
                "property_type": profile["property_type"],
                "current_site_eui_kwh_m2": current,
                "target_site_eui_kwh_m2": target,
                "saving_mwh": round(delta_kwh / 1000.0, 1),
                "saving_tco2e": round(delta_t, 1),
            }
        )

    candidates.sort(key=lambda c: -c["saving_mwh"])
    return {
        "target": f"cohort p{int(target_percentile)} site EUI",
        "buildings_above_target": len(candidates),
        "annual_saving_mwh": round(savings_mwh, 1),
        "annual_saving_tco2e": round(savings_t, 1),
        "top_candidates": candidates[:12],
        "assumption": (
            "Each building is held to a percentile its own EWRB cohort already reports. "
            "No retrofit measure is modelled - this is the gap to observed practice."
        ),
    }
