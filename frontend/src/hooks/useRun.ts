import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { RunResult, ScenarioKind } from '@/api/types';
import { demoRun } from '@/demo/fixtures';

/**
 * The current run.
 *
 * Prefers TigerData (`/simulation/live`, then `/simulation/run` which also
 * serves TigerData when present). Falls back to hardcoded demo fixtures only
 * when the database has nothing to show.
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
      // 1) Explicit live TigerData window
      try {
        const fromLive = await api.liveRun('nightcity');
        setResult({
          ...fromLive,
          scenario: { ...fromLive.scenario, kind, id: kind, label: fromLive.scenario.label },
        });
        setLive(true);
        return;
      } catch {
        // continue
      }

      // 2) /run also returns TigerData when telemetry/weather exist
      const fromApi = await api.run({
        scenario: kind,
        district_id: 'nightcity',
        optimize: true,
        params: {},
      });
      setResult(fromApi);
      setLive(Boolean(fromApi.source && fromApi.source !== 'demo'));
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
