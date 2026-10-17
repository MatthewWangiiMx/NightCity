import type { Scenario, ScenarioKind } from '@/api/types';

export default function ScenarioPicker({
  scenarios = [],
  value,
  onChange,
}: {
  scenarios?: Scenario[];
  value?: ScenarioKind;
  onChange?: (kind: ScenarioKind) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-nc-muted">Current scenario</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value as ScenarioKind)}
        className="mt-1 w-full rounded-lg border border-nc-border bg-nc-bg px-3 py-2 text-sm"
      >
        {scenarios.length === 0 && <option value="">No scenarios loaded</option>}
        {scenarios.map((s) => (
          <option key={s.id} value={s.kind}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
