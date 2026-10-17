/**
 * Building electricity + construction profile.
 * Geometry/heights prefer TigerData (Toronto 3D Massing); load mix stays illustrative.
 */

export type BuildingConstruction = {
  levels: number;
  floors_estimated: boolean;
  min_h: number | null;
  max_h: number | null;
  avg_h: number | null;
  height_src: string | null;
  bldg_src: string | null;
  data_source: 'tigerdata' | 'massing-cache';
};

export type BuildingElectricity = {
  id: string;
  name: string;
  kind: string;
  floors: number;
  footprint_m2: number;
  height_m: number;
  /** Instantaneous demand estimate */
  demand_kw: number;
  peak_kw: number;
  daily_kwh: number;
  annual_mwh: number;
  load_factor_pct: number;
  renewable_offset_pct: number;
  ev_chargers: number;
  hvac_share_pct: number;
  lighting_share_pct: number;
  plug_share_pct: number;
  grid_import_kw: number;
  status: 'nominal' | 'elevated' | 'flexible';
  construction: BuildingConstruction;
};

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const KIND_INTENSITY: Record<string, number> = {
  tower: 1.15,
  hotel: 1.35,
  arena: 1.55,
  stadium: 1.4,
  station: 1.25,
  civic: 1.05,
  landmark: 1.2,
  residential: 0.75,
  office: 1.1,
  structure: 1.0,
};

export function estimateBuildingElectricity(input: {
  id: string;
  name: string;
  kind?: string;
  height_m: number;
  footprint_m2: number;
  seed?: number;
  floors?: number;
  floors_estimated?: boolean;
  min_h?: number | null;
  max_h?: number | null;
  avg_h?: number | null;
  height_src?: string | null;
  bldg_src?: string | null;
  data_source?: BuildingConstruction['data_source'];
}): BuildingElectricity {
  const kind = input.kind ?? (input.height_m >= 80 ? 'office' : 'structure');
  const floors =
    input.floors != null && input.floors > 0
      ? Math.round(input.floors)
      : Math.max(1, Math.round(input.height_m / 3.2));
  const area = Math.max(40, input.footprint_m2);
  const gfa = area * floors;
  const seed = input.seed ?? input.id.length * 97 + Math.round(input.height_m * 10);
  const jitter = 0.85 + hash01(seed) * 0.3;
  const intensity = (KIND_INTENSITY[kind] ?? 1) * jitter;

  const wPerM2 = 55 * intensity;
  const peak_kw = (gfa * wPerM2) / 1000;
  const load_factor = 0.38 + hash01(seed + 3) * 0.22;
  const demand_kw = peak_kw * (0.55 + hash01(seed + 5) * 0.35);
  const daily_kwh = peak_kw * load_factor * 24;
  const annual_mwh = (daily_kwh * 365) / 1000;

  const hvac = 38 + Math.round(hash01(seed + 7) * 12);
  const lighting = 22 + Math.round(hash01(seed + 9) * 8);
  const plug = Math.max(10, 100 - hvac - lighting);

  const renewable = Math.round(8 + hash01(seed + 11) * 28);
  const ev =
    kind === 'arena' || kind === 'stadium' || kind === 'hotel'
      ? 8 + Math.round(hash01(seed + 13) * 24)
      : Math.round(hash01(seed + 13) * 6);

  const flex = hash01(seed + 17);
  const status: BuildingElectricity['status'] =
    demand_kw > peak_kw * 0.85 ? 'elevated' : flex > 0.7 ? 'flexible' : 'nominal';

  return {
    id: input.id,
    name: input.name,
    kind,
    floors,
    footprint_m2: Math.round(area),
    height_m: Math.round(input.height_m * 10) / 10,
    demand_kw: Math.round(demand_kw * 10) / 10,
    peak_kw: Math.round(peak_kw * 10) / 10,
    daily_kwh: Math.round(daily_kwh),
    annual_mwh: Math.round(annual_mwh),
    load_factor_pct: Math.round(load_factor * 100),
    renewable_offset_pct: renewable,
    ev_chargers: ev,
    hvac_share_pct: hvac,
    lighting_share_pct: lighting,
    plug_share_pct: plug,
    grid_import_kw: Math.round(demand_kw * (1 - renewable / 100) * 10) / 10,
    status,
    construction: {
      levels: floors,
      floors_estimated: input.floors_estimated ?? input.floors == null,
      min_h: input.min_h ?? null,
      max_h: input.max_h ?? null,
      avg_h: input.avg_h ?? input.height_m,
      height_src: input.height_src ?? null,
      bldg_src: input.bldg_src ?? null,
      data_source: input.data_source ?? 'massing-cache',
    },
  };
}
