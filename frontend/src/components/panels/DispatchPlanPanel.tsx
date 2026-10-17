import Panel from '@/components/Panel';
import type { DispatchAction, GridStatus, Metrics } from '@/api/types';

const KIND_ICON: Record<DispatchAction['kind'], string> = {
  battery_discharge: '▮',
  shift_ev_charging: '⚡',
  precool_building: '▣',
  curtail_flexible_load: '⌁',
};

/** Short effect line under each action, e.g. "Reduces peak load". */
const KIND_EFFECT: Record<DispatchAction['kind'], string> = {
  battery_discharge: 'Reduces peak load',
  shift_ev_charging: 'Flattens demand curve',
  precool_building: 'Lowers peak, keeps comfort',
  curtail_flexible_load: 'Sheds non-critical load',
};

export default function DispatchPlanPanel({
  actions,
  baseline,
  optimized,
  gridStatus,
  explanation,
  className = '',
}: {
  actions: DispatchAction[];
  baseline?: Metrics;
  optimized?: Metrics;
  gridStatus?: GridStatus;
  explanation?: string | null;
  className?: string;
}) {
  const peakDrop =
    baseline && optimized
      ? Math.round((1 - optimized.peak_demand_mw / baseline.peak_demand_mw) * 100)
      : null;
  const emissionsDrop =
    baseline && optimized
      ? Math.round((1 - optimized.emissions_tco2e / baseline.emissions_tco2e) * 100)
      : null;

  return (
    <Panel
      title="AI Dispatch Plan"
      subtitle="Real-time optimization for a stable, clean and cost-efficient grid"
      className={className}
    >
      {actions.length === 0 ? (
        <p className="text-xs text-nc-muted">No plan yet — run a scenario.</p>
      ) : (
        <ol className="space-y-2.5">
          {actions.map((a, i) => (
            <li key={a.id} className="rounded-lg border border-nc-border bg-nc-bg/40 p-3">
              <div className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-nc-renew text-[11px] text-nc-renew">
                  {i + 1}
                </span>
                <span className="mt-0.5 text-base text-nc-grid" aria-hidden>
                  {KIND_ICON[a.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-nc-muted">{a.detail}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-nc-panel-2 px-2 py-0.5 text-[11px] text-nc-muted">
                      {KIND_EFFECT[a.kind]}
                    </span>
                    <span className="rounded bg-nc-renew/15 px-2 py-0.5 text-[11px] text-nc-renew tabular-nums">
                      +{a.delta_mw} MW
                    </span>
                  </div>
                  {/* Explainability: reason, constraint and assumption always travel with the action. */}
                  <details className="mt-2 text-[11px] text-nc-muted">
                    <summary className="cursor-pointer select-none hover:text-nc-text">
                      Why this action
                    </summary>
                    <div className="mt-1 space-y-0.5 border-l border-nc-border pl-2">
                      <div>Reason: {a.reason}</div>
                      <div>Constraint: {a.constraint}</div>
                      <div>Assumption: {a.assumption}</div>
                    </div>
                  </details>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {peakDrop !== null && emissionsDrop !== null && (
        <div className="rounded-lg border border-nc-renew/40 bg-nc-renew/10 p-3 text-xs">
          <div className="font-medium text-nc-renew">
            Result: {peakDrop}% lower peak load · {emissionsDrop}% less emissions
          </div>
          {gridStatus && (
            <div className="text-nc-muted">
              Grid stability maintained at {gridStatus.stability_pct}%
            </div>
          )}
        </div>
      )}

      {explanation && (
        <p className="rounded-lg border border-nc-border bg-nc-bg/60 p-3 text-xs text-nc-muted">
          {explanation}
          <span className="mt-1 block italic">
            LLM narration of simulator output — not a source of numbers.
          </span>
        </p>
      )}
    </Panel>
  );
}
