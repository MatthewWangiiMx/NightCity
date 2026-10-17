import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { RunResult, ScenarioKind } from '@/api/types';
import { demoRun } from '@/demo/fixtures';

/**
 * The current run.
 *
 * Tries the backend first and falls back to the hardcoded demo data, so the UI
 * is complete today and starts showing real simulator output the moment
 * `/api/simulation/run` stops returning 501 — no component changes needed.
 */
export function useRun(initial: ScenarioKind = 'solar_drop') {
  const [scenario, setScenario] = useState<ScenarioKind>(initial);
  const [result, setResult] = useState<RunResult>(() => demoRun(initial));
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);

  const run = useCallback(async (kind: ScenarioKind) => {
    setScenario(kind);
    setLoading(true);
    try {
      const fromApi = await api.run({
        scenario: kind,
        district_id: 'nightcity',
        optimize: true,
        params: {},
      });
      setResult(fromApi);
      setLive(true);
    } catch {
      setResult(demoRun(kind));
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(initial);
    // Only on mount: later runs are driven by the Simulate screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scenario, result, loading, live, run };
}
