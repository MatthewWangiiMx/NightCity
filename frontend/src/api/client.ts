import type {
  District,
  DispatchAction,
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
  id?: number;
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
};
