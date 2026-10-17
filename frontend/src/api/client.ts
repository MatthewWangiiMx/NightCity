import type { District, DispatchAction, RunRequest, RunResult, Scenario, TimeStep } from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string; database: string; llm: string }>('/health'),
  district: (id = 'nightcity') => request<District>(`/district/${id}`),
  scenarios: () => request<Scenario[]>('/scenarios'),
  run: (body: RunRequest) =>
    request<RunResult>('/simulation/run', { method: 'POST', body: JSON.stringify(body) }),
  playback: (runId: string, variant: 'baseline' | 'optimized' = 'optimized') =>
    request<TimeStep[]>(`/simulation/runs/${runId}/playback?variant=${variant}`),
  dispatch: (runId: string) => request<DispatchAction[]>(`/dispatch/${runId}`),
};
