/**
 * Hardcoded demo data.
 *
 * Stands in for the backend simulator until `app/sim/simulator.py` is written.
 * Shapes match the real API contracts in `@/api/types`, so swapping in a live
 * run is a change of source, not of components. Everything here is synthetic
 * and illustrative — the same caveat the real simulator carries.
 */

import type {
  District,
  DispatchAction,
  GridStatus,
  Metrics,
  RunResult,
  Scenario,
  ScenarioKind,
  TimeStep,
} from '@/api/types';

export const EVENT_LABEL = 'Solar Drop';
export const EVENT_TIME = '18:42';
const EVENT_INDEX = 11; // 18:45 step — the scrubber marker sits here

export const DISTRICT: District = {
  id: 'nightcity',
  name: 'Night City District',
  assets: [
    // x/y are normalized scene coords, placed over the matching landmark in
    // the isometric map (solar field, turbines, downtown, battery yard, EV pad).
    { id: 'solar_farm', name: 'Solar Farm', kind: 'solar', capacity_mw: 120, x: 0.21, y: 0.3 },
    { id: 'wind', name: 'Wind Turbines', kind: 'wind', capacity_mw: 85, x: 0.71, y: 0.26 },
    { id: 'city', name: 'City District', kind: 'building', capacity_mw: 320, x: 0.5, y: 0.5 },
    { id: 'battery', name: 'Battery Storage', kind: 'battery', capacity_mw: 60, x: 0.85, y: 0.54 },
    { id: 'ev', name: 'EV Charging', kind: 'ev_charging', capacity_mw: 42, x: 0.17, y: 0.69 },
    { id: 'grid', name: 'Grid Tie', kind: 'grid_tie', capacity_mw: 500, x: 0.5, y: 0.93 },
  ],
  flows: [
    { id: 'f1', from_asset: 'solar_farm', to_asset: 'city', mw: 78 },
    { id: 'f2', from_asset: 'wind', to_asset: 'city', mw: 52 },
    { id: 'f3', from_asset: 'battery', to_asset: 'city', mw: 42 },
    { id: 'f4', from_asset: 'city', to_asset: 'ev', mw: 28 },
    { id: 'f5', from_asset: 'grid', to_asset: 'city', mw: 140 },
  ],
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'solar_drop',
    kind: 'solar_drop',
    label: 'Solar Drop',
    description: 'Cloud cover cuts solar output 35% as evening demand rises.',
    event_time: EVENT_TIME,
  },
  {
    id: 'heat_wave',
    kind: 'heat_wave',
    label: 'Heat Wave',
    description: 'Sustained high ambient temperature drives HVAC load up across the district.',
    event_time: '17:15',
  },
  {
    id: 'storm',
    kind: 'storm',
    label: 'City-wide Blackout',
    description: 'A storm takes a transmission line and local generation out of service.',
    event_time: '18:00',
  },
  {
    id: 'ev_surge',
    kind: 'ev_surge',
    label: 'EV Surge',
    description: 'Simultaneous evening plug-in across every charging hub.',
    event_time: '18:30',
  },
  {
    id: 'battery_outage',
    kind: 'battery_outage',
    label: 'Battery Outage',
    description: 'Shared storage goes offline in the middle of the event.',
    event_time: '18:42',
  },
];

/** 16:00 → 21:00 in 15-minute steps. */
export const TIME_LABELS: string[] = Array.from({ length: 21 }, (_, i) => {
  const minutes = 16 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function isoAt(index: number): string {
  const minutes = 16 * 60 + index * 15;
  return new Date(Date.UTC(2026, 9, 16, Math.floor(minutes / 60), minutes % 60)).toISOString();
}

/** Evening demand ramp: flat, then a climb to a 19:30 peak, then decline. */
function demandAt(i: number): number {
  const peak = 689;
  const shape = Math.exp(-Math.pow((i - 14) / 6.5, 2));
  return 430 + (peak - 430) * shape;
}

/** Clear-sky solar bell, cut by 35% once the event lands. */
function solarAt(i: number): number {
  const clear = Math.max(0, 300 * Math.exp(-Math.pow((i - 2) / 5.5, 2)));
  return i >= EVENT_INDEX ? clear * 0.65 : clear;
}

function windAt(i: number): number {
  return 52 + 14 * Math.sin(i / 3);
}

function buildSteps(optimized: boolean): TimeStep[] {
  return TIME_LABELS.map((_, i) => {
    const demandRaw = demandAt(i);
    const solar = solarAt(i);
    const wind = windAt(i);

    // The plan discharges the battery and shifts flexible load across the peak.
    const inEvent = optimized && i >= EVENT_INDEX && i <= EVENT_INDEX + 6;
    const battery = inEvent ? 42 : optimized && i < EVENT_INDEX ? -18 : 0;
    const shifted = inEvent ? 28 + 18 : 0; // EV shifting + HVAC pre-cooling
    const precool = optimized && i < EVENT_INDEX ? 22 : 0;

    const demand = demandRaw - shifted + precool;
    const gridImport = Math.max(0, demand - solar - wind - Math.max(battery, 0));

    return {
      t: isoAt(i),
      demand_mw: Math.round(demand),
      solar_mw: Math.round(solar),
      wind_mw: Math.round(wind),
      battery_mw: battery,
      battery_soc: optimized ? Math.max(0.2, 0.8 - Math.max(0, i - EVENT_INDEX) * 0.06) : 0.8,
      grid_import_mw: Math.round(gridImport),
      indoor_temp_c: optimized ? 21.4 + (i < EVENT_INDEX ? -0.6 : 0.8) : 22.0 + (i > EVENT_INDEX ? 1.9 : 0),
    };
  });
}

export const BASELINE_STEPS = buildSteps(false);
export const OPTIMIZED_STEPS = buildSteps(true);

export const BASELINE_METRICS: Metrics = {
  peak_demand_mw: 689,
  energy_cost: 41_340,
  emissions_tco2e: 312,
  comfort_violation_minutes: 85,
  renewable_share_pct: 46,
};

export const OPTIMIZED_METRICS: Metrics = {
  peak_demand_mw: 552,
  energy_cost: 33_120,
  emissions_tco2e: 213,
  comfort_violation_minutes: 0,
  renewable_share_pct: 62,
};

export const GRID_STATUS: GridStatus = {
  stability_pct: 98,
  frequency_hz: 60.0,
  voltage_pu: 1.0,
  reserve_pct: 18,
};

export const ACTIONS: DispatchAction[] = [
  {
    id: 'a1',
    kind: 'battery_discharge',
    title: 'Discharge neighborhood battery',
    detail: 'Add 42 MW for 30 minutes',
    target_asset: 'battery',
    delta_mw: 42,
    reason: 'Covers the solar shortfall without raising grid import',
    constraint: 'State of charge held above 20%',
    assumption: 'Synthetic battery: 60 MW / 240 MWh, 92% round-trip',
  },
  {
    id: 'a2',
    kind: 'shift_ev_charging',
    title: 'Shift EV charging by 20 min',
    detail: 'Move 60% of flexible charging sessions',
    target_asset: 'ev',
    delta_mw: 28,
    reason: 'Flattens the demand curve across the evening peak',
    constraint: 'Every vehicle still reaches its departure target',
    assumption: 'Synthetic fleet: 60% of sessions declared flexible',
  },
  {
    id: 'a3',
    kind: 'precool_building',
    title: 'Pre-cool flexible buildings',
    detail: 'Adjust HVAC setpoints by 2°C before the peak',
    target_asset: 'city',
    delta_mw: 18,
    reason: 'Buys thermal headroom so cooling can idle through the peak',
    constraint: 'Indoor temperature stays within 20–24°C — hard constraint',
    assumption: 'Synthetic first-order thermal model per building',
  },
];

export const ENERGY_MIX = [
  { name: 'Solar', share: 28 },
  { name: 'Wind', share: 34 },
  { name: 'Battery', share: 8 },
  { name: 'Natural gas', share: 30 },
];

export const COMFORT_CHANNELS = [
  { name: 'Temperature', value: 92, status: 'Within bounds' },
  { name: 'Air quality', value: 88, status: 'Within bounds' },
  { name: 'Lighting', value: 96, status: 'Within bounds' },
];

export function demoRun(scenario: ScenarioKind = 'solar_drop'): RunResult {
  return {
    run_id: 'demo-run',
    scenario: SCENARIOS.find((s) => s.kind === scenario) ?? SCENARIOS[0],
    district: DISTRICT,
    baseline: BASELINE_STEPS,
    optimized: OPTIMIZED_STEPS,
    baseline_metrics: BASELINE_METRICS,
    optimized_metrics: OPTIMIZED_METRICS,
    grid_status: GRID_STATUS,
    actions: ACTIONS,
    explanation: null,
    is_simulated: true,
    weather: [],
    source: 'demo',
  };
}

/** Index of the event marker within the window, for charts and the scrubber. */
export const EVENT_STEP = EVENT_INDEX;
