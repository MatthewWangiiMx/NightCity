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
