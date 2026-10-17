import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type {
  EwrbBuildingProfile,
  EwrbCitySummary,
  EwrbDistrictRollup,
  EwrbFsaArea,
} from '@/api/types';

/**
 * EWRB access for the UI.
 *
 * The dataset is optional infrastructure, same as TigerData and the LLM layer:
 * when `backend/data/odc_final_dataset_2024.csv` is absent the API answers 503
 * and these hooks report `unavailable` so callers can fall back to their own
 * estimates rather than render an empty panel.
 */

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Module-level cache: the cohort table is identical for every consumer. */
const summaryCache = new Map<string, EwrbCitySummary>();
const profileCache = new Map<string, EwrbBuildingProfile>();

/** City-wide reported distributions and property-type mix. */
export function useEwrbSummary(city = 'Toronto') {
  const [summary, setSummary] = useState<EwrbCitySummary | null>(
    () => summaryCache.get(city) ?? null,
  );
  const [status, setStatus] = useState<Status>(() =>
    summaryCache.has(city) ? 'ready' : 'idle',
  );

  useEffect(() => {
    const cached = summaryCache.get(city);
    if (cached) {
      setSummary(cached);
      setStatus('ready');
      return;
    }
    let active = true;
    setStatus('loading');
    api
      .ewrbSummary(city)
      .then((data) => {
        if (!active) return;
        summaryCache.set(city, data);
        setSummary(data);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setStatus('unavailable');
      });
    return () => {
      active = false;
    };
  }, [city]);

  return { summary, status };
}

/** Median reported intensity per postal FSA. */
export function useEwrbFsaAreas(city = 'Toronto') {
  const [areas, setAreas] = useState<EwrbFsaArea[]>([]);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    api
      .ewrbFsaAreas(city)
      .then((data) => {
        if (!active) return;
        setAreas(data.areas);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setAreas([]);
        setStatus('unavailable');
      });
    return () => {
      active = false;
    };
  }, [city]);

  return { areas, status };
}

/**
 * Profile for the building the viewer has selected.
 *
 * The panel renders its geometry immediately from what the raycast already
 * knows, so this only drives the reported half. Results are cached by building
 * so reselecting is instant, and a stale response from a previous selection is
 * discarded rather than painted over the current one.
 */
export function useEwrbProfile() {
  const [profile, setProfile] = useState<EwrbBuildingProfile | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const requestId = useRef(0);

  const clear = useCallback(() => {
    requestId.current += 1;
    setProfile(null);
    setStatus('idle');
  }, []);

  const load = useCallback(
    (building: {
      id: string;
      footprint_m2: number;
      name?: string;
      kind?: string | null;
      height_m?: number | null;
      levels?: number | null;
      lat?: number | null;
      lon?: number | null;
      hour?: number | null;
    }) => {
      const key = `${building.id}|${Math.round(building.footprint_m2)}|${building.kind ?? ''}|${building.levels ?? ''}`;
      const token = ++requestId.current;

      const cached = profileCache.get(key);
      if (cached) {
        setProfile(cached);
        setStatus('ready');
        return;
      }

      setProfile(null);
      setStatus('loading');
      api
        .ewrbProfile(building)
        .then((data) => {
          if (token !== requestId.current) return; // selection moved on
          profileCache.set(key, data);
          setProfile(data);
          setStatus('ready');
        })
        .catch(() => {
          if (token !== requestId.current) return;
          setProfile(null);
          setStatus('unavailable');
        });
    },
    [],
  );

  return { profile, status, load, clear };
}

/**
 * District rollup over the stock already in TigerData.
 *
 * For pages that show no massing of their own. Reports `unavailable` when the
 * database is off, since absolute totals need a floor area EWRB does not
 * publish - callers then fall back to intensity-only figures.
 */
export function useEwrbLiveDistrict(city = 'Toronto') {
  const [rollup, setRollup] = useState<EwrbDistrictRollup | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    api
      .ewrbLiveDistrict(city)
      .then((data) => {
        if (!active) return;
        setRollup(data);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setRollup(null);
        setStatus('unavailable');
      });
    return () => {
      active = false;
    };
  }, [city]);

  return { rollup, status };
}

/**
 * District rollup over a set of buildings.
 *
 * Posts geometry rather than ids so it works against cached massing too. The
 * payload is capped on both sides; this picks the largest buildings, which
 * carry nearly all the floor area and so dominate the rollup.
 */
export function useEwrbDistrict(
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
  max = 1500,
) {
  const [rollup, setRollup] = useState<EwrbDistrictRollup | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  // Only the set's size and total area decide whether to refetch: the array
  // identity changes on every viewer render.
  const signature = `${city}|${buildings.length}|${Math.round(
    buildings.reduce((sum, b) => sum + (b.footprint_m2 || 0), 0),
  )}`;

  useEffect(() => {
    if (!buildings.length) {
      setStatus('idle');
      return;
    }
    const payload = [...buildings]
      .sort((a, b) => (b.footprint_m2 || 0) - (a.footprint_m2 || 0))
      .slice(0, max);

    let active = true;
    setStatus('loading');
    api
      .ewrbDistrict(payload, city)
      .then((data) => {
        if (!active) return;
        setRollup(data);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setRollup(null);
        setStatus('unavailable');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, max]);

  return { rollup, status };
}
