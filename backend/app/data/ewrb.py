"""Ontario EWRB (Energy & Water Reporting and Benchmarking) reference dataset.

This is the one layer in NightCity carrying *reported* figures rather than
simulated ones: large-building and broader-public-sector operators file annual
energy and water totals, and the province publishes them per property.

Units, derived from the fixed ratios between the paired columns in the source
file:

    *_Int1 / Site_EUI1 / Source_EUI1   GJ per m2 per year
    *_Int2 / Site_EUI2 / Source_EUI2   equivalent kWh per ft2 per year
    WN_Sit_Gas_Int3                    m3 of gas per ft2 per year
    All_Water_Int1 / Ind_Water_Int1    m3 per m2 per year
    All_Water_Int2 / Ind_Water_Int2    m3 per ft2 per year
    GHG_Emiss_Int1                     kg CO2e per m2 per year
    GHG_Emiss_Int2                     kg CO2e per ft2 per year

Confirmed against the data:

    Site_EUI2 / Site_EUI1   == 25.806  == (1000/3.6) / 10.7639
    All_Water_Int1 / Int2   == 10.7639 == ft2 per m2
    GHG_Emiss_Int1 / Int2   == 10.7639

The WN_ columns are weather-normalised, which is what a benchmark wants: they
strip out how hot or cold the reporting year happened to be.

IMPORTANT - what this dataset cannot do. Rows carry City and a three-character
postal FSA, never coordinates or an address. No key joins an EWRB row to a City
of Toronto 3D Massing footprint, so NightCity never claims "this tower reported
this number". Instead a massing building is matched to a *cohort* (FSA plus
property type, widening to city or province when the sample is thin) and the
cohort's reported intensity distribution is applied to its floor area. The
intensity is measured; attributing it to one building is an estimate. Every
payload says which is which through its basis and sample_size fields.
"""

from __future__ import annotations

import csv
import math
from bisect import bisect_left
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Sequence

DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "odc_final_dataset_2024.csv"

# Unit conversions
KWH_PER_GJ = 1000.0 / 3.6  # 277.78
FT2_PER_M2 = 10.7639

# Sentinels the province writes for a withheld or unreported value.
_MISSING = {"", "not available", "n/a", "na", "-", "not applicable"}

# Minimum rows before a cohort is reported on its own rather than widened.
MIN_COHORT_N = 5

# Plausibility bounds per metric, as [floor, ceiling] in the normalised unit.
#
# The published file carries a long tail of impossible filings: the worst site
# EUI in it is 4,477,023 kWh/m2-yr and the worst gas intensity 4,743,560, which
# are several thousand times any real building. They look like totals entered in
# an intensity column, or an area field off by orders of magnitude. Left in they
# wreck every statistic that touches them - one such row moved a cohort's
# reported maximum to 569,650 and inflated a district's avoidable energy to
# 120 TWh.
#
# Ceilings sit above the genuine extremes (data centres, labs, ice rinks and
# hospitals really do pass 1,000 kWh/m2-yr; p99 here is 1,636) so real outliers
# survive and only the physically impossible is cut. Excluded counts are
# reported, never silently dropped.
PLAUSIBLE_RANGE: dict[str, tuple[float, float]] = {
    "elec_kwh_m2": (1.0, 3000.0),
    "gas_kwh_m2": (1.0, 3000.0),
    "site_eui_kwh_m2": (5.0, 3000.0),
    "source_eui_kwh_m2": (5.0, 4000.0),
    "ghg_kg_m2": (0.1, 500.0),
    "water_m3_m2": (0.005, 50.0),
    "energy_star_score": (1.0, 100.0),
}


def is_plausible(metric: str, value: float | None) -> bool:
    """Whether a reported value is inside the physical range for its metric."""
    if value is None:
        return False
    bounds = PLAUSIBLE_RANGE.get(metric)
    if bounds is None:
        return True
    return bounds[0] <= value <= bounds[1]

# A massing building's `kind` (from the 3D viewer) to the EWRB property types
# that best represent it. First candidate with a usable cohort wins.
KIND_TO_PROPERTY_TYPES: dict[str, tuple[str, ...]] = {
    "tower": ("Office", "Multifamily Housing"),
    "office": ("Office",),
    "residential": ("Multifamily Housing", "Other - Lodging/Residential"),
    "hotel": ("Hotel", "Other - Lodging/Residential"),
    "arena": ("Ice/Curling Rink", "Indoor Arena", "Fitness Center/Health Club/Gym"),
    "stadium": ("Stadium (Open)", "Indoor Arena", "Ice/Curling Rink"),
    "station": ("Transit Station", "Other - Public Services", "Office"),
    "civic": ("Other - Public Services", "Courthouse", "Library", "Office"),
    "landmark": ("Office", "Other"),
    "structure": ("Office", "Multifamily Housing"),
    "retail": ("Retail Store", "Strip Mall", "Enclosed Mall"),
    "industrial": ("Manufacturing/Industrial Plant", "Non-Refrigerated Warehouse"),
}

# Approximate FSA centroids for the downtown massing envelope
# (lat 43.63..43.66, lon -79.41..-79.36). Nearest-centroid assignment only:
# real FSAs are polygons, so the result is a neighbourhood hint, not a geocode.
DOWNTOWN_FSA_CENTROIDS: dict[str, tuple[float, float]] = {
    "M5V": (43.6426, -79.3938),  # Entertainment District / CityPlace
    "M5J": (43.6408, -79.3817),  # Harbourfront / Union
    "M5H": (43.6496, -79.3833),  # Financial core
    "M5X": (43.6479, -79.3817),  # First Canadian Place
    "M5G": (43.6565, -79.3858),  # Discovery District
    "M5B": (43.6572, -79.3789),  # Dundas / Toronto Metropolitan
    "M5A": (43.6542, -79.3606),  # Distillery / Corktown
    "M5T": (43.6532, -79.4000),  # Kensington / Chinatown
    "M5S": (43.6627, -79.3957),  # University of Toronto
    "M6K": (43.6368, -79.4282),  # Liberty Village
    "M5C": (43.6515, -79.3754),  # St. Lawrence
    "M5E": (43.6447, -79.3733),  # Berczy Park
}

# The metrics a cohort reports a distribution for, and the unit each carries.
COHORT_METRICS: dict[str, str] = {
    "elec_kwh_m2": "kWh/m2-yr",
    "gas_kwh_m2": "kWh/m2-yr",
    "site_eui_kwh_m2": "kWh/m2-yr",
    "source_eui_kwh_m2": "kWh/m2-yr",
    "ghg_kg_m2": "kg CO2e/m2-yr",
    "water_m3_m2": "m3/m2-yr",
    "energy_star_score": "score 1-100",
}


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return None if text.lower() in _MISSING else text


def _number(value: str | None) -> float | None:
    text = _clean(value)
    if text is None:
        return None
    try:
        out = float(text.replace(",", ""))
    except ValueError:
        return None
    return None if math.isnan(out) or math.isinf(out) else out


def _gj_m2_to_kwh_m2(value: float | None) -> float | None:
    return None if value is None else value * KWH_PER_GJ


class EwrbRow:
    """One reported property, with units normalised to kWh/m2-yr."""

    __slots__ = (
        "ewrb_id", "city", "fsa", "property_type", "self_reported_type",
        "largest_type", "all_types", "certification",
        "elec_kwh_m2", "gas_kwh_m2", "gas_m3_ft2",
        "site_eui_kwh_m2", "source_eui_kwh_m2",
        "wn_site_eui_kwh_m2", "wn_source_eui_kwh_m2",
        "ghg_kg_m2", "water_m3_m2", "indoor_water_m3_m2",
        "energy_star_score", "energy_star_certified",
        "data_quality_checked", "data_quality_date",
    )

    def __init__(self, raw: dict[str, str]) -> None:
        self.ewrb_id = _clean(raw.get("EWRB_ID"))
        self.city = _clean(raw.get("City"))
        self.fsa = (_clean(raw.get("Postal_Code")) or "").upper()[:3] or None
        self.property_type = _clean(raw.get("PrimPropTypCalc"))
        self.self_reported_type = _clean(raw.get("PrimPropTypSelf"))
        self.largest_type = _clean(raw.get("Largest_PropTyp"))
        self.all_types = _clean(raw.get("All_Prop_Types"))
        self.certification = _clean(raw.get("Thrd_Party_Cert"))

        # Weather-normalised fuel intensities, GJ/m2 in source.
        self.elec_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("WN_Sit_Elc_Int1")))
        self.gas_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("WN_Sit_Gas_Int1")))
        self.gas_m3_ft2 = _number(raw.get("WN_Sit_Gas_Int3"))

        self.site_eui_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("Site_EUI1")))
        self.source_eui_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("Source_EUI1")))
        self.wn_site_eui_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("WN_Site_EUI1")))
        self.wn_source_eui_kwh_m2 = _gj_m2_to_kwh_m2(_number(raw.get("WN_Source_EUI1")))

        self.ghg_kg_m2 = _number(raw.get("GHG_Emiss_Int1"))
        self.water_m3_m2 = _number(raw.get("All_Water_Int1"))
        self.indoor_water_m3_m2 = _number(raw.get("Ind_Water_Int1"))

        self.energy_star_score = _number(raw.get("Ener_Star_Score"))
        self.energy_star_certified = _clean(raw.get("Ener_Star_Certs"))
        self.data_quality_checked = (_clean(raw.get("Data_Qual_Check")) or "").lower() == "yes"
        self.data_quality_date = _clean(raw.get("Data_Qual_Date"))

    @property
    def electrification_pct(self) -> float | None:
        """Share of site energy met by electricity rather than fuel.

        Measured against reported site EUI, not against electricity plus gas.
        Many rows report site energy while withholding the gas line, and
        dividing by electricity alone would call every one of those 100%
        electric when the missing fuel is exactly what we cannot see.
        """
        elec = self.elec_kwh_m2
        if elec is None:
            return None
        site = self.site_eui_kwh_m2
        if site and site > 0:
            return round(min(100.0, 100.0 * elec / site), 1)
        gas = self.gas_kwh_m2
        if gas is None:
            return None  # No denominator we can trust.
        total = elec + gas
        return None if total <= 0 else round(100.0 * elec / total, 1)

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {slot: getattr(self, slot) for slot in self.__slots__}
        for key in (
            "elec_kwh_m2", "gas_kwh_m2", "site_eui_kwh_m2", "source_eui_kwh_m2",
            "wn_site_eui_kwh_m2", "wn_source_eui_kwh_m2", "ghg_kg_m2",
        ):
            if out[key] is not None:
                out[key] = round(out[key], 1)
        for key in ("water_m3_m2", "indoor_water_m3_m2", "gas_m3_ft2"):
            if out[key] is not None:
                out[key] = round(out[key], 3)
        out["electrification_pct"] = self.electrification_pct
        return out


@lru_cache(maxsize=1)
def load_rows() -> tuple[EwrbRow, ...]:
    """Parse the published CSV once per process."""
    if not DATA_FILE.exists():
        return ()
    with DATA_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        return tuple(EwrbRow(raw) for raw in csv.DictReader(handle))


def dataset_available() -> bool:
    return bool(load_rows())


# --------------------------------------------------------------------------
# Distributions
# --------------------------------------------------------------------------

def _percentile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile; q in 0..1."""
    if not sorted_values:
        raise ValueError("empty sequence")
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = q * (len(sorted_values) - 1)
    low, high = math.floor(pos), math.ceil(pos)
    if low == high:
        return sorted_values[low]
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (pos - low)


def _distribution(values: Iterable[float], excluded: int = 0) -> dict[str, Any] | None:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    return {
        "n": len(vals),
        "min": round(vals[0], 2),
        "p05": round(_percentile(vals, 0.05), 2),
        "p25": round(_percentile(vals, 0.25), 2),
        "median": round(_percentile(vals, 0.50), 2),
        "p75": round(_percentile(vals, 0.75), 2),
        "p95": round(_percentile(vals, 0.95), 2),
        "max": round(vals[-1], 2),
        "mean": round(sum(vals) / len(vals), 2),
        # Filings outside the metric's physical range, excluded from the above.
        "excluded": excluded,
    }


def _metric_values(rows: Sequence[EwrbRow], metric: str) -> list[float]:
    """Plausible reported values for one metric; implausible filings dropped."""
    return [
        v
        for v in (getattr(r, metric, None) for r in rows)
        if v is not None and v > 0 and is_plausible(metric, v)
    ]


def _metric_excluded(rows: Sequence[EwrbRow], metric: str) -> int:
    return sum(
        1
        for v in (getattr(r, metric, None) for r in rows)
        if v is not None and v > 0 and not is_plausible(metric, v)
    )


def _summarise(rows: Sequence[EwrbRow]) -> dict[str, Any]:
    """Every tracked metric's distribution over one set of rows."""
    stats: dict[str, Any] = {}
    for metric in COHORT_METRICS:
        dist = _distribution(
            _metric_values(rows, metric), excluded=_metric_excluded(rows, metric)
        )
        if dist is not None:
            stats[metric] = dist
    return {
        "sample_size": len(rows),
        "metrics": stats,
        "energy_star_certified": sum(1 for r in rows if r.energy_star_certified),
        "data_quality_checked": sum(1 for r in rows if r.data_quality_checked),
    }


@lru_cache(maxsize=1)
def _index() -> dict[str, Any]:
    """Pre-group rows by the keys cohorts are drawn on."""
    by_city: dict[str, list[EwrbRow]] = defaultdict(list)
    by_type: dict[str, list[EwrbRow]] = defaultdict(list)
    by_city_type: dict[tuple[str, str], list[EwrbRow]] = defaultdict(list)
    by_fsa_type: dict[tuple[str, str], list[EwrbRow]] = defaultdict(list)
    by_fsa: dict[str, list[EwrbRow]] = defaultdict(list)

    for row in load_rows():
        city = (row.city or "").strip()
        ptype = row.property_type or "Unknown"
        by_type[ptype].append(row)
        if city:
            by_city[city].append(row)
            by_city_type[(city.lower(), ptype)].append(row)
        if row.fsa:
            by_fsa[row.fsa].append(row)
            by_fsa_type[(row.fsa, ptype)].append(row)

    return {
        "by_city": dict(by_city),
        "by_type": dict(by_type),
        "by_city_type": dict(by_city_type),
        "by_fsa_type": dict(by_fsa_type),
        "by_fsa": dict(by_fsa),
    }


def property_types(min_n: int = MIN_COHORT_N) -> list[dict[str, Any]]:
    """Property types with enough rows to benchmark against, largest first."""
    out = [
        {"property_type": ptype, "sample_size": len(rows)}
        for ptype, rows in _index()["by_type"].items()
        if len(rows) >= min_n
    ]
    out.sort(key=lambda r: -r["sample_size"])
    return out


def cohort(
    property_type: str,
    *,
    fsa: str | None = None,
    city: str | None = None,
    min_n: int = MIN_COHORT_N,
) -> dict[str, Any] | None:
    """Reported distribution for a property type at the narrowest usable scope.

    Widens FSA -> city -> province until the sample reaches min_n, and names the
    level it settled on in `basis` so the caller can disclose it.
    """
    idx = _index()
    attempts: list[tuple[str, str, Sequence[EwrbRow]]] = []
    if fsa:
        code = fsa.upper()[:3]
        attempts.append((f"fsa:{code}", "fsa", idx["by_fsa_type"].get((code, property_type), ())))
    if city:
        name = city.strip()
        attempts.append(
            (f"city:{name}", "city", idx["by_city_type"].get((name.lower(), property_type), ()))
        )
    attempts.append(("province:Ontario", "province", idx["by_type"].get(property_type, ())))

    for scope, level, rows in attempts:
        if len(rows) >= min_n:
            summary = _summarise(rows)
            summary.update({"property_type": property_type, "scope": scope, "basis": level})
            return summary

    # Nothing met the threshold - fall back to the widest set we have, if any.
    rows = idx["by_type"].get(property_type, ())
    if not rows:
        return None
    summary = _summarise(rows)
    summary.update(
        {"property_type": property_type, "scope": "province:Ontario", "basis": "province-thin"}
    )
    return summary


@lru_cache(maxsize=256)
def _ranked_values(property_type: str, metric: str) -> tuple[float, ...]:
    """Sorted plausible values for a province-wide cohort, cached.

    Memoised because colouring a whole city asks for one rank per building:
    re-sorting the cohort each time made a 1,300-building request take over a
    second, almost all of it repeated work over the same few hundred rows.
    """
    return tuple(sorted(_metric_values(_index()["by_type"].get(property_type, ()), metric)))


def percentile_rank(property_type: str, metric: str, value: float) -> float | None:
    """Where `value` sits in its province-wide cohort, 0..100 (lower = leaner)."""
    vals = _ranked_values(property_type, metric)
    if len(vals) < MIN_COHORT_N:
        return None
    return round(100.0 * bisect_left(vals, value) / len(vals), 1)


def cohort_rows(
    property_type: str,
    *,
    fsa: str | None = None,
    city: str | None = None,
    min_n: int = MIN_COHORT_N,
) -> tuple[list[EwrbRow], str, str]:
    """The rows behind `cohort()`, plus the scope and basis they were drawn at."""
    idx = _index()
    attempts: list[tuple[str, str, Sequence[EwrbRow]]] = []
    if fsa:
        code = fsa.upper()[:3]
        attempts.append((f"fsa:{code}", "fsa", idx["by_fsa_type"].get((code, property_type), ())))
    if city:
        name = city.strip()
        attempts.append(
            (f"city:{name}", "city", idx["by_city_type"].get((name.lower(), property_type), ()))
        )
    attempts.append(("province:Ontario", "province", idx["by_type"].get(property_type, ())))

    for scope, level, rows in attempts:
        if len(rows) >= min_n:
            return list(rows), scope, level
    rows = idx["by_type"].get(property_type, ())
    return list(rows), "province:Ontario", "province-thin"


def representative_row(
    property_type: str,
    quantile: float,
    *,
    fsa: str | None = None,
    city: str | None = None,
) -> tuple[EwrbRow, str, str, int] | None:
    """One real reported property at `quantile` of its cohort's site EUI.

    Returning an actual row rather than a blend of percentiles keeps a building's
    figures internally consistent: its electricity, gas, emissions, water and
    ENERGY STAR score all come from the same real property, so a gas-heated
    comparable reads as gas-heated across every field. Returns the row, the
    scope and basis it was drawn at, and the cohort size.
    """
    rows, scope, basis = cohort_rows(property_type, fsa=fsa, city=city)
    ranked = sorted(
        (r for r in rows if is_plausible("site_eui_kwh_m2", r.site_eui_kwh_m2)),
        key=lambda r: r.site_eui_kwh_m2 or 0.0,
    )
    if not ranked:
        return None
    q = min(max(quantile, 0.0), 1.0)
    index = min(len(ranked) - 1, int(round(q * (len(ranked) - 1))))
    return ranked[index], scope, basis, len(ranked)


def nearest_fsa(lat: float, lon: float, max_km: float = 3.0) -> str | None:
    """Nearest downtown FSA centroid, or None if the point is outside the set.

    Nearest-centroid, not a point-in-polygon geocode - see module docstring.
    """
    best: tuple[float, str] | None = None
    for fsa, (clat, clon) in DOWNTOWN_FSA_CENTROIDS.items():
        dx = (lon - clon) * math.cos(math.radians(lat)) * 111.32
        dy = (lat - clat) * 110.54
        km = math.hypot(dx, dy)
        if best is None or km < best[0]:
            best = (km, fsa)
    if best is None or best[0] > max_km:
        return None
    return best[1]


def resolve_property_type(
    kind: str | None,
    *,
    fsa: str | None = None,
    city: str | None = "Toronto",
) -> tuple[str, dict[str, Any]] | None:
    """Pick the EWRB property type and cohort that best represent a massing kind."""
    candidates = KIND_TO_PROPERTY_TYPES.get((kind or "structure").lower()) or ("Office",)
    for ptype in candidates:
        found = cohort(ptype, fsa=fsa, city=city)
        if found and found["basis"] != "province-thin":
            return ptype, found
    for ptype in candidates:
        found = cohort(ptype, fsa=fsa, city=city)
        if found:
            return ptype, found
    return None


def city_summary(city: str) -> dict[str, Any] | None:
    idx = _index()
    rows = idx["by_city"].get(city.strip())
    if not rows:
        for name, candidate in idx["by_city"].items():
            if name.lower() == city.strip().lower():
                rows = candidate
                break
    if not rows:
        return None
    summary = _summarise(rows)
    summary["city"] = city
    types: dict[str, int] = defaultdict(int)
    for row in rows:
        types[row.property_type or "Unknown"] += 1
    summary["property_type_mix"] = sorted(
        ({"property_type": k, "count": v} for k, v in types.items()),
        key=lambda r: -r["count"],
    )
    return summary


def fsa_breakdown(city: str = "Toronto", min_n: int = MIN_COHORT_N) -> list[dict[str, Any]]:
    """Per-FSA reported intensity for one city, densest FSA first."""
    idx = _index()
    out: list[dict[str, Any]] = []
    needle = city.strip().lower()
    for fsa, rows in idx["by_fsa"].items():
        local = [r for r in rows if (r.city or "").lower() == needle]
        if len(local) < min_n:
            continue
        site = _distribution(_metric_values(local, "site_eui_kwh_m2"))
        ghg = _distribution(_metric_values(local, "ghg_kg_m2"))
        out.append(
            {
                "fsa": fsa,
                "sample_size": len(local),
                "site_eui_kwh_m2": site["median"] if site else None,
                "ghg_kg_m2": ghg["median"] if ghg else None,
            }
        )
    out.sort(key=lambda r: -r["sample_size"])
    return out


def filter_rows(
    *,
    city: str | None = None,
    fsa: str | None = None,
    property_type: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[EwrbRow], int]:
    """Raw reported rows, for the Simulate and Plan pages."""
    rows: Sequence[EwrbRow] = load_rows()
    if city:
        needle = city.strip().lower()
        rows = [r for r in rows if (r.city or "").lower() == needle]
    if fsa:
        code = fsa.strip().upper()[:3]
        rows = [r for r in rows if r.fsa == code]
    if property_type:
        needle = property_type.strip().lower()
        rows = [r for r in rows if (r.property_type or "").lower() == needle]
    total = len(rows)
    return list(rows[offset : offset + limit]), total
