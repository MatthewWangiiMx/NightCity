import { useState } from 'react';
import { SCENARIOS } from '@/demo/fixtures';
import type { ScenarioKind } from '@/api/types';

export default function EventDialog({
  open,
  loading,
  initial,
  onRun,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  initial: ScenarioKind;
  onRun: (kind: ScenarioKind) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<ScenarioKind>(initial);
  const selected = SCENARIOS.find((s) => s.kind === choice);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-nc-bg/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        className="w-full max-w-md rounded-2xl border border-nc-border bg-nc-panel p-6 shadow-2xl"
      >
        <h2 id="event-dialog-title" className="text-lg font-semibold">
          Select an event to simulate
        </h2>
        <p className="mt-1 text-xs text-nc-muted">
          The simulator reruns the whole evening window, with and without coordination.
        </p>

        <div className="mt-5 space-y-2">
          {SCENARIOS.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                choice === s.kind
                  ? 'border-nc-renew bg-nc-renew/10'
                  : 'border-nc-border hover:border-nc-grid'
              }`}
            >
              <input
                type="radio"
                name="event"
                value={s.kind}
                checked={choice === s.kind}
                onChange={() => setChoice(s.kind)}
                className="mt-1 accent-[var(--color-nc-renew)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-[11px] text-nc-muted">
                  {s.event_time} · {s.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        {selected && (
          <p className="mt-4 text-[11px] text-nc-muted">
            Comfort bounds stay a hard constraint for every event.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-nc-border px-4 py-2 text-sm text-nc-muted transition hover:text-nc-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onRun(choice)}
            disabled={loading}
            className="rounded-lg bg-nc-renew px-4 py-2 text-sm font-medium text-nc-bg transition hover:brightness-110 disabled:opacity-60"
          >
            {loading ? 'Simulating…' : 'Run simulation'}
          </button>
        </div>
      </div>
    </div>
  );
}
