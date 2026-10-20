import type {
  District,
  DispatchAction,
  EwrbBenchmarks,
  EwrbBuildingProfile,
  EwrbCitySummary,
  EwrbDistrictRollup,
  EwrbEuiResponse,
  EwrbLevers,
  EwrbPlanDay,
  EwrbBuildingPlan,
  EwrbPlanResult,
  EwrbFsaArea,
  EwrbMeta,
  EwrbRecordPage,
  EwrbSource,
  RunRequest,
  RunResult,
  Scenario,
  TimeStep,
  WeatherObservation,
} from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export type MassingBuilding = {
  id?: number | string;
  /** Logical structure this part belongs to. 3D Massing splits a complex into
   *  a podium plus the towers inside it, so several parts share one of these.
   *  Absent on the static cache, which is already one row per building. */
  structure_id?: number | string;
  /** The structure's union ground area. Summing the parts' own footprints
   *  double-counts where a tower sits inside a podium. */
  structure_footprint_m2?: number | null;
  node_id?: string;
  h: number;
  levels?: number;
  floors_estimated?: boolean;
  min_h?: number | null;
  max_h?: number | null;
  avg_h?: number | null;
  height_src?: string | null;
  bldg_src?: string | null;
  rings: [number, number][][];
};

export type MassingData = {
  source: string;
  license: string;
  url: string;
  count: number;
  landmarks?: { cnTower?: { x: number; z: number; height: number } };
  buildings: MassingBuilding[];
};

export const api = {
  health: () => request<{ status: string; database: string; llm: string }>('/health'),
  district: (id = 'nightcity') => request<District>(`/district/${id}`),
  scenarios: () => request<Scenario[]>('/scenarios'),
  run: (body: RunRequest) =>
    request<RunResult>('/simulation/run', { method: 'POST', body: JSON.stringify(body) }),
  /** Latest TigerData telemetry + weather window. */
  liveRun: (districtId = 'nightcity') =>
    request<RunResult>(`/simulation/live?district_id=${encodeURIComponent(districtId)}`),
  playback: (runId: string, variant: 'baseline' | 'optimized' = 'optimized') =>
    request<TimeStep[]>(`/simulation/runs/${runId}/playback?variant=${variant}`),
  telemetry: (districtId = 'nightcity', limit = 500) =>
    request<TimeStep[]>(`/simulation/telemetry/${encodeURIComponent(districtId)}?limit=${limit}`),
  dispatch: (runId: string) => request<DispatchAction[]>(`/dispatch/${runId}`),
  weather: (limit = 168) =>
    request<WeatherObservation[]>(`/weather/observations?limit=${limit}`),
  /** Live TigerData massing; throws if DB empty / disabled. */
  buildingsMassing: () => request<MassingData>('/buildings/massing'),
  building: (id: number) => request<Record<string, unknown>>(`/buildings/${id}`),

  // --- Ontario EWRB reported benchmarks ---
  // The one measured layer in the app. See backend/app/data/ewrb.py.
  ewrbMeta: () => request<EwrbMeta>('/ewrb/meta'),
  /** Cohort table: one entry per property type, fetched once and reused. */
  ewrbBenchmarks: (city = 'Toronto', fsa?: string) =>
    request<EwrbBenchmarks>(
      `/ewrb/benchmarks?city=${encodeURIComponent(city)}${fsa ? `&fsa=${encodeURIComponent(fsa)}` : ''}`,
    ),
  ewrbSummary: (city = 'Toronto') =>
    request<EwrbCitySummary>(`/ewrb/summary?city=${encodeURIComponent(city)}`),
  ewrbFsaAreas: (city = 'Toronto') =>
    request<{ source: EwrbSource; city: string; areas: EwrbFsaArea[] }>(
      `/ewrb/fsa?city=${encodeURIComponent(city)}`,
    ),
  ewrbRecords: (params: {
    city?: string;
    fsa?: string;
    propertyType?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.city) q.set('city', params.city);
    if (params.fsa) q.set('fsa', params.fsa);
    if (params.propertyType) q.set('property_type', params.propertyType);
    q.set('limit', String(params.limit ?? 200));
    q.set('offset', String(params.offset ?? 0));
    return request<EwrbRecordPage>(`/ewrb/records?${q.toString()}`);
  },
  /** EWRB-grounded profile for a building the viewer already has geometry for. */
  ewrbProfile: (building: {
    id: string;
    footprint_m2: number;
    name?: string;
    kind?: string | null;
    height_m?: number | null;
    levels?: number | null;
    lat?: number | null;
    lon?: number | null;
    fsa?: string | null;
    hour?: number | null;
  }) => {
    const q = new URLSearchParams({
      building_id: building.id,
      footprint_m2: String(Math.max(1, Math.round(building.footprint_m2))),
    });
    if (building.name) q.set('name', building.name);
    if (building.kind) q.set('kind', building.kind);
    if (building.height_m != null) q.set('height_m', String(building.height_m));
    if (building.levels != null) q.set('levels', String(building.levels));
    if (building.lat != null) q.set('lat', String(building.lat));
    if (building.lon != null) q.set('lon', String(building.lon));
    if (building.fsa) q.set('fsa', building.fsa);
    if (building.hour != null) q.set('hour', String(building.hour));
    return request<EwrbBuildingProfile>(`/ewrb/profile?${q.toString()}`);
  },
  /** Reported site EUI for many buildings at once, to colour the 3D city. */
  ewrbBuildingEuis: (
    buildings: {
      id: string;
      footprint_m2: number;
      kind?: string | null;
      h?: number | null;
      levels?: number | null;
      lat?: number | null;
      lon?: number | null;
    }[],
    city = 'Toronto',
  ) =>
    request<EwrbEuiResponse>(`/ewrb/buildings/eui?city=${encodeURIComponent(city)}`, {
      method: 'POST',
      body: JSON.stringify(buildings),
    }),
  /** Run the Plan levers over the measured stock; 503 when the DB is off. */
  ewrbPlan: (
    levers: Partial<EwrbLevers> = {},
    city = 'Toronto',
    day?: Partial<EwrbPlanDay> | null,
  ) => {
    const q = new URLSearchParams({ city });
    Object.entries({ ...levers, ...(day ?? {}) }).forEach(([k, v]) => {
      if (v != null) q.set(k, String(v));
    });
    return request<EwrbPlanResult>(`/ewrb/plan?${q.toString()}`);
  },
  /** One building, today against the plan — for the results page's card. */
  ewrbBuildingPlan: (
    building: {
      id: string;
      footprint_m2: number;
      name?: string;
      kind?: string | null;
      height_m?: number | null;
      levels?: number | null;
      lat?: number | null;
      lon?: number | null;
    },
    levers: Partial<EwrbLevers> = {},
    day?: Partial<EwrbPlanDay> | null,
  ) => {
    const q = new URLSearchParams({
      building_id: building.id,
      footprint_m2: String(Math.max(1, Math.round(building.footprint_m2))),
    });
    if (building.name) q.set('name', building.name);
    if (building.kind) q.set('kind', building.kind);
    if (building.height_m != null) q.set('height_m', String(building.height_m));
    if (building.levels != null) q.set('levels', String(building.levels));
    if (building.lat != null) q.set('lat', String(building.lat));
    if (building.lon != null) q.set('lon', String(building.lon));
    Object.entries({ ...levers, ...(day ?? {}) }).forEach(([k, v]) => {
      if (v != null) q.set(k, String(v));
    });
    return request<EwrbBuildingPlan>(`/ewrb/building-plan?${q.toString()}`);
  },
  /** District rollup over the stock in TigerData; 503 when the DB is off. */
  ewrbLiveDistrict: (city = 'Toronto') =>
    request<EwrbDistrictRollup>(`/ewrb/district/live?city=${encodeURIComponent(city)}`),
  /** Roll the massing on screen up into district totals. */
  ewrbDistrict: (
    buildings: {
      id: string;
      footprint_m2: number;
      kind?: string | null;
      h?: number | null;
      levels?: number | null;
      lat?: number | null;
      lon?: number | null;
    }[],
    city = 'Toronto',
  ) =>
    request<EwrbDistrictRollup>(`/ewrb/district?city=${encodeURIComponent(city)}`, {
      method: 'POST',
      body: JSON.stringify(buildings),
    }),
};
