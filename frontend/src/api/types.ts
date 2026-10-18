// Mirrors backend/app/schemas/models.py. Keep both sides in step.

export type AssetKind =
  | 'solar' | 'wind' | 'battery' | 'ev_charging' | 'building' | 'grid_tie';

export type ScenarioKind =
  | 'baseline' | 'solar_drop' | 'heat_wave' | 'ev_surge' | 'battery_outage' | 'storm';

export type ActionKind =
  | 'battery_discharge' | 'shift_ev_charging' | 'precool_building' | 'curtail_flexible_load';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  capacity_mw: number;
  x: number; // 0..1 scene coords
  y: number;
}

export interface EnergyFlow {
  id: string;
  from_asset: string;
  to_asset: string;
  mw: number;
}

export interface District {
  id: string;
  name: string;
  assets: Asset[];
  flows: EnergyFlow[];
}

export interface TimeStep {
  t: string;
  demand_mw: number;
  solar_mw: number;
  wind_mw: number;
  battery_mw: number;
  battery_soc: number;
  grid_import_mw: number;
  indoor_temp_c: number | null;
  /** Set for per-building rows; null on district aggregates (sum of buildings). */
  building_id?: string | null;
}

export interface GridStatus {
  stability_pct: number;
  frequency_hz: number;
  voltage_pu: number;
  reserve_pct: number;
}

export interface Metrics {
  peak_demand_mw: number;
  energy_cost: number;
  emissions_tco2e: number;
  comfort_violation_minutes: number;
  renewable_share_pct: number;
}

export interface DispatchAction {
  id: string;
  kind: ActionKind;
  title: string;
  detail: string;
  target_asset: string;
  delta_mw: number;
  reason: string;
  constraint: string;
  assumption: string;
}

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  label: string;
  description: string;
  event_time: string | null;
}

export interface RunRequest {
  scenario: ScenarioKind;
  district_id: string;
  optimize: boolean;
  params: Record<string, number>;
}

export interface WeatherObservation {
  observation_time: string;
  latitude: number;
  longitude: number;
  temperature_2m_c: number | null;
  precipitation_mm: number | null;
  wind_speed_10m_kmh: number | null;
  weather_code: number | null;
}

export interface DailyForecastDay {
  date: string;
  weather_code: number;
  temp_max_c: number;
  temp_min_c: number;
  precip_mm: number;
  wind_max_kmh: number;
}

export interface DailyForecastResponse {
  timezone: string;
  days: DailyForecastDay[];
  source: string;
}

export interface PlanApplyResponse {
  selected_date: string;
  weather: DailyForecastDay;
  baseline_metrics: Metrics;
  plan_metrics: Metrics;
  weather_demand_factor: number;
  explanation: string;
}

export interface RunResult {
  run_id: string;
  scenario: Scenario;
  district: District;
  baseline: TimeStep[];
  optimized: TimeStep[];
  baseline_metrics: Metrics;
  optimized_metrics: Metrics;
  grid_status: GridStatus;
  actions: DispatchAction[];
  explanation: string | null;
  is_simulated: boolean;
  weather?: WeatherObservation[];
  source?: 'demo' | 'tigerdata-run' | 'tigerdata-telemetry' | string;
}

// --- Ontario EWRB reported benchmarks -------------------------------------
// Mirrors backend/app/data/ewrb.py and backend/app/sim/ewrb_profile.py.
// Reported (measured) fields are grouped under `intensity`; anything under
// `demand` is modelled from declared assumptions. See `provenance`.

export interface EwrbSource {
  dataset: string;
  publisher: string;
  license: string;
  url: string;
  note: string;
}

/** Distribution of one reported metric across a cohort. */
export interface EwrbDistribution {
  n: number;
  min: number;
  p05: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
  mean: number;
  /** Filings outside the metric's physical range, excluded from the stats. */
  excluded: number;
}

export type EwrbMetricKey =
  | 'elec_kwh_m2'
  | 'gas_kwh_m2'
  | 'site_eui_kwh_m2'
  | 'source_eui_kwh_m2'
  | 'ghg_kg_m2'
  | 'water_m3_m2'
  | 'energy_star_score';

/** How wide a net the cohort was drawn from. */
export type EwrbBasis = 'fsa' | 'city' | 'province' | 'province-thin';

export interface EwrbCohort {
  property_type: string;
  scope: string;
  basis: EwrbBasis;
  sample_size: number;
  metrics: Partial<Record<EwrbMetricKey, EwrbDistribution>>;
  energy_star_certified: number;
  data_quality_checked: number;
}

export interface EwrbBenchmarks {
  source: EwrbSource;
  city: string | null;
  fsa: string | null;
  kind_map: Record<string, string[]>;
  cohorts: Record<string, EwrbCohort>;
}

/** Reported intensities, as filed with the province. */
export interface EwrbIntensity {
  elec_kwh_m2: number | null;
  gas_kwh_m2: number | null;
  site_eui_kwh_m2: number | null;
  source_eui_kwh_m2: number | null;
  ghg_kg_m2: number | null;
  water_m3_m2: number | null;
  energy_star_score: number | null;
  electrification_pct: number | null;
}

/** Annual totals: reported intensity x this building's floor area. */
export interface EwrbAnnual {
  elec_mwh: number;
  gas_mwh: number;
  site_energy_mwh: number;
  emissions_tco2e: number;
  water_m3: number;
}

/** Modelled electrical shape. EWRB reports annual totals only. */
export interface EwrbDemand {
  avg_kw: number;
  peak_kw: number;
  demand_kw: number;
  at_hour: number;
  load_factor_pct: number;
  flexible_kw: number;
  shape: 'residential' | 'commercial' | 'continuous';
  curve_kw: number[];
  hvac_share_pct: number;
  lighting_share_pct: number;
  plug_share_pct: number;
}

export interface EwrbBenchmarkPosition {
  scope: string;
  basis: EwrbBasis;
  sample_size: number;
  ranked_sample: number;
  assigned_percentile: number;
  site_eui_percentile: number | null;
  ghg_percentile: number | null;
  cohort_median_site_eui: number | null;
  cohort_p25_site_eui: number | null;
  cohort_p75_site_eui: number | null;
  /** p05 / p95 of the cohort, so one extreme cannot squash the strip. */
  cohort_min_site_eui: number | null;
  cohort_max_site_eui: number | null;
  cohort_excluded_filings: number;
  comparable_ewrb_id: string | null;
  comparable_certification: string | null;
  data_quality_checked: boolean;
}

export interface EwrbProvenance {
  measured: string;
  modelled: string;
  caveat: string;
}

export interface EwrbBuildingProfile {
  source?: EwrbSource;
  building_id: string;
  name: string;
  kind: string | null;
  property_type: string;
  fsa: string | null;
  city: string;
  footprint_m2: number;
  levels: number;
  floors_estimated: boolean;
  height_m: number | null;
  gross_floor_area_m2: number;
  intensity: EwrbIntensity;
  annual: EwrbAnnual;
  demand: EwrbDemand;
  benchmark: EwrbBenchmarkPosition;
  provenance: EwrbProvenance;
}

/** One reported property, as published. */
export interface EwrbRecord {
  ewrb_id: string | null;
  city: string | null;
  fsa: string | null;
  property_type: string | null;
  self_reported_type: string | null;
  largest_type: string | null;
  all_types: string | null;
  certification: string | null;
  elec_kwh_m2: number | null;
  gas_kwh_m2: number | null;
  gas_m3_ft2: number | null;
  site_eui_kwh_m2: number | null;
  source_eui_kwh_m2: number | null;
  wn_site_eui_kwh_m2: number | null;
  wn_source_eui_kwh_m2: number | null;
  ghg_kg_m2: number | null;
  water_m3_m2: number | null;
  indoor_water_m3_m2: number | null;
  energy_star_score: number | null;
  energy_star_certified: string | null;
  data_quality_checked: boolean;
  data_quality_date: string | null;
  electrification_pct: number | null;
}

export interface EwrbRecordPage {
  source: EwrbSource;
  total: number;
  limit: number;
  offset: number;
  records: EwrbRecord[];
}

export interface EwrbCitySummary extends EwrbCohort {
  city: string;
  property_type_mix: { property_type: string; count: number }[];
}

export interface EwrbFsaArea {
  fsa: string;
  sample_size: number;
  site_eui_kwh_m2: number | null;
  ghg_kg_m2: number | null;
}

/** District rollup for the Simulate and Plan pages. */
export interface EwrbDistrictRollup {
  source: EwrbSource;
  city: string;
  skipped: number;
  peak_hour: number | null;
  buildings: number;
  gross_floor_area_m2: number;
  annual: EwrbAnnual;
  demand: {
    peak_mw: number;
    non_coincident_peak_mw: number;
    diversity_factor: number | null;
    avg_mw: number;
    flexible_mw: number;
    curve_mw: number[];
  };
  intensity: {
    mean_site_eui_kwh_m2: number | null;
    area_weighted_ghg_kg_m2: number | null;
    mean_energy_star_score: number | null;
    scored_buildings: number;
  };
  retrofit: {
    target: string;
    buildings_above_target: number;
    annual_saving_mwh: number;
    annual_saving_tco2e: number;
    top_candidates: {
      building_id: string;
      name: string;
      property_type: string;
      current_site_eui_kwh_m2: number;
      target_site_eui_kwh_m2: number;
      saving_mwh: number;
      saving_tco2e: number;
    }[];
    assumption: string;
  };
}

export interface EwrbMeta {
  source: EwrbSource;
  rows: number;
  cities: { city: string; count: number }[];
  property_types: { property_type: string; sample_size: number }[];
  metrics: Record<string, string>;
  min_cohort_size: number;
}

/** Bounds the EUI colour ramp is anchored on, over the buildings on screen. */
export interface EwrbEuiScale {
  min: number;
  p05: number;
  median: number;
  /** The cutoff the viewer paints from: only the worst quartile is coloured. */
  p75: number;
  p95: number;
  max: number;
  n: number;
}

export interface EwrbEuiRow {
  id: string;
  eui: number;
  property_type: string;
  percentile: number | null;
  fsa: string | null;
}

export interface EwrbEuiResponse {
  source: EwrbSource;
  city: string;
  scale: EwrbEuiScale | null;
  buildings: EwrbEuiRow[];
}

// --- Plan page levers: what-if over measured building energy ---------------

export interface EwrbFuelTotals {
  elec_mwh: number;
  gas_mwh: number;
  site_mwh: number;
  emissions_tco2e: number;
  electrified_pct: number | null;
}

export interface EwrbLeverEffect {
  lever: 'retrofit' | 'setpoint' | 'lighting' | 'heat_pump' | string;
  label: string;
  delta_elec_mwh: number;
  delta_gas_mwh: number;
  delta_site_mwh: number;
  delta_tco2e: number;
  detail: string;
}

export interface EwrbPlanResult {
  source: EwrbSource;
  city: string;
  buildings: number;
  gross_floor_area_m2: number;
  baseline: EwrbFuelTotals;
  planned: EwrbFuelTotals;
  change: {
    site_mwh: number;
    site_pct: number | null;
    elec_mwh: number;
    elec_pct: number | null;
    gas_mwh: number;
    gas_pct: number | null;
    emissions_tco2e: number;
    emissions_pct: number | null;
  };
  breakdown: EwrbLeverEffect[];
  peak: EwrbPeakResponse;
  weather: EwrbWeatherDay;
  day_curve: EwrbDayCurve;
  factors: {
    elec_kg_per_kwh: number;
    gas_kg_per_kwh: number;
    source: string;
  };
  assumptions: Record<string, string | number>;
}

/** The knobs the Plan page exposes. */
export interface EwrbLevers {
  // Consumption: these change how much energy the district uses in a year.
  heat_pump_pct: number;
  heat_pump_cop: number;
  retrofit_pct: number;
  retrofit_target_percentile: number;
  setpoint_widen_c: number;
  lighting_retrofit_pct: number;
  // Dispatch: these change the shape of the peak, not the annual total.
  flex_ev_pct: number;
  flex_hvac_pct: number;
  flex_industrial_pct: number;
  air_quality_floor_pct: number;
  lighting_floor_pct: number;
}

/** One forecast day's energy, derived from degree-days. */
export interface EwrbWeatherDay {
  available: boolean;
  temp_c?: number;
  hdd?: number;
  cdd?: number;
  heating_vs_average?: number;
  cooling_vs_average?: number;
  day_elec_mwh?: number;
  day_gas_mwh?: number;
  day_site_mwh?: number;
  day_emissions_tco2e?: number;
  average_day_site_mwh?: number;
  vs_average_pct?: number | null;
  baseline_day_site_mwh?: number;
  baseline_day_emissions_tco2e?: number;
  driver?: string;
  precip_mm?: number;
  note?: string;
}

/** The forecast day the plan is evaluated against. */
export interface EwrbPlanDay {
  day_temp_c: number;
  day_weather_code?: number;
  day_wind_kmh?: number;
  day_precip_mm?: number;
  /** 24 hourly temperatures for the day; drives the HVAC shape of the curve. */
  day_hourly_temps_c?: number[];
}

/** Hourly electricity for the selected day, baseline against plan. */
export interface EwrbDayCurve {
  available: boolean;
  hours?: number[];
  baseline_mw?: number[];
  planned_mw?: number[];
  baseline_peak_mw?: number;
  planned_peak_mw?: number;
  baseline_peak_hour?: number;
  planned_peak_hour?: number;
  planned_day_elec_mwh?: number;
  /** True when real hourly temperatures shaped the HVAC component. */
  weather_driven?: boolean;
  heat_pump_day_mwh?: number;
  /** Extra electricity because COP falls with outdoor temperature. */
  cop_penalty_mwh?: number;
  effective_cop?: number | null;
  rated_cop?: number;
  note?: string;
}

export interface EwrbPeakAction {
  action: string;
  label: string;
  mw: number;
  kind: 'shifted' | 'shed' | string;
  detail: string;
}

export interface EwrbPeakResponse {
  available: boolean;
  peak_hour?: number;
  baseline_peak_mw?: number;
  planned_peak_mw?: number;
  reduction_mw?: number;
  reduction_pct?: number;
  actions?: EwrbPeakAction[];
  note?: string;
}

/** One building's own before/after, from the same lever engine. */
export interface EwrbBuildingPlan extends EwrbPlanResult {
  building: {
    id: string;
    name: string;
    property_type: string;
    fsa: string | null;
    gross_floor_area_m2: number;
    site_eui_kwh_m2: number | null;
    energy_star_score: number | null;
    percentile: number | null;
  };
}
