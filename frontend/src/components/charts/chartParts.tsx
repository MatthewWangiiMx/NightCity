import type { TooltipProps } from 'recharts';
import type { TimeStep } from '@/api/types';
import { EVENT_LABEL, EVENT_STEP, EVENT_TIME, TIME_LABELS } from '@/demo/fixtures';

export const SERIES = {
  demand: 'var(--color-series-demand)',
  renew: 'var(--color-series-renew)',
  solar: 'var(--color-series-solar)',
  neutral: 'var(--color-series-neutral)',
} as const;

export const AXIS = {
  stroke: '#2a4f63',
  tick: { fill: '#7fa6b6', fontSize: 11 },
} as const;

/** Chart rows: a short clock label plus the measures each chart draws. */
export function toRows(baseline: TimeStep[], optimized?: TimeStep[]) {
  return baseline.map((step, i) => {
    const plan = optimized?.[i];
    return {
      label: new Date(step.t).toISOString().slice(11, 16),
      demand: step.demand_mw,
      renewables: step.solar_mw + step.wind_mw,
      solar: step.solar_mw,
      baselineImport: step.grid_import_mw,
      planImport: plan?.grid_import_mw,
    };
  });
}

/** Crosshair tooltip. Values wear text tokens; the swatch carries identity. */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-nc-border bg-nc-bg/95 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-nc-text">{label}</div>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-nc-muted">{entry.name}</span>
            <span className="ml-auto text-nc-text">{Math.round(Number(entry.value))} MW</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Disruption marker snapped to a category tick (demo index, else mid-window). */
export function eventMarkerFor(rows: { label: string }[]) {
  if (!rows.length) return null;
  const idx = Math.min(EVENT_STEP, rows.length - 1);
  return {
    x: rows[idx]?.label ?? rows[Math.floor(rows.length / 2)].label,
    label: `${EVENT_LABEL} ${EVENT_TIME}`,
  };
}

/** @deprecated prefer eventMarkerFor(rows) so TigerData windows align. */
export const eventMarker = {
  x: TIME_LABELS[EVENT_STEP],
  label: `${EVENT_LABEL} ${EVENT_TIME}`,
};
