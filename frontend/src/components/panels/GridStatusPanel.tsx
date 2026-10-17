import Panel from '@/components/Panel';
import type { GridStatus, Scenario, ScenarioKind } from '@/api/types';
import { SCENARIOS } from '@/demo/fixtures';

/** Stability ring: a hero number, not a chart. */
function StabilityRing({ pct }: { pct: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative grid h-24 w-24 shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-nc-border)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--color-nc-renew)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className="text-center leading-tight">
        <div className="text-2xl font-semibold">{pct}%</div>
        <div className="text-[10px] text-nc-renew">Stable</div>
      </div>
    </div>
  );
}

export default function GridStatusPanel({
  status,
  scenario,
  onScenarioChange,
}: {
  status: GridStatus;
  scenario?: Scenario;
  onScenarioChange?: (kind: ScenarioKind) => void;
}) {
  const rows: [string, string][] = [
    ['Frequency', `${status.frequency_hz.toFixed(2)} Hz`],
    ['Voltage', `${status.voltage_pu.toFixed(2)} p.u.`],
    ['Reserve', `${status.reserve_pct.toFixed(0)}%`],
  ];

  return (
    <Panel title="Live Grid Twin">
      <label className="block rounded-lg border border-nc-border bg-nc-bg/60 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-nc-muted">Current scenario</span>
        <select
          value={scenario?.kind ?? 'solar_drop'}
          onChange={(e) => onScenarioChange?.(e.target.value as ScenarioKind)}
          disabled={!onScenarioChange}
          className="mt-0.5 w-full bg-transparent text-sm font-medium text-nc-text outline-none disabled:opacity-80"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.kind} className="bg-nc-panel">
              {s.label} · {s.event_time}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-4">
        <div className="shrink-0 text-center">
          <StabilityRing pct={status.stability_pct} />
          <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-nc-muted">
            Grid stability
          </div>
        </div>
        <dl className="flex-1 space-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-nc-muted">{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
