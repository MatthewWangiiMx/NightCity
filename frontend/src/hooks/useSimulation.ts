import { useCallback, useState } from 'react';
import { api } from '@/api/client';
import type { RunRequest, RunResult, ScenarioKind } from '@/api/types';

/** Owns the current run. One run holds both the baseline and the optimized plan. */
export function useSimulation() {
  const [result, setResult] = useState<RunResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(async (scenario: ScenarioKind, params: Record<string, number> = {}) => {
    const body: RunRequest = { scenario, district_id: 'nightcity', optimize: true, params };
    setLoading(true);
    setError(undefined);
    try {
      setResult(await api.run(body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, run };
}
