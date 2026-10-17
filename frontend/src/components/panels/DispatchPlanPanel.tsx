import Panel from '@/components/Panel';
import type { DispatchAction } from '@/api/types';

export default function DispatchPlanPanel({
  actions = [],
  explanation,
}: {
  actions?: DispatchAction[];
  explanation?: string | null;
}) {
  return (
    <Panel
      title="AI Dispatch Plan"
      subtitle="Real-time optimization for a stable, clean and cost-efficient grid"
    >
      {actions.length === 0 && (
        <p className="text-xs text-nc-muted">No plan yet — run a scenario.</p>
      )}
      <ol className="space-y-3">
        {actions.map((a, i) => (
          <li key={a.id} className="flex gap-3 rounded-lg border border-nc-border p-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-nc-renew text-xs text-nc-renew">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{a.title}</div>
              <div className="text-xs text-nc-muted">{a.detail}</div>
              {/* Explainability: reason / constraint / assumption are always shown. */}
              <div className="mt-2 space-y-0.5 text-[11px] text-nc-muted">
                <div>Why: {a.reason}</div>
                <div>Constraint: {a.constraint}</div>
                <div>Assumption: {a.assumption}</div>
              </div>
            </div>
            <span className="self-start rounded bg-nc-renew/15 px-2 py-0.5 text-xs text-nc-renew">
              {a.delta_mw > 0 ? '+' : ''}
              {a.delta_mw} MW
            </span>
          </li>
        ))}
      </ol>
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
