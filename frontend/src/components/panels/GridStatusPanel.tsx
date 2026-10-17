import Panel from '@/components/Panel';
import type { GridStatus } from '@/api/types';

export default function GridStatusPanel({ status }: { status?: GridStatus }) {
  const rows: [string, string][] = [
    ['Frequency', status ? `${status.frequency_hz.toFixed(2)} Hz` : '—'],
    ['Voltage', status ? `${status.voltage_pu.toFixed(2)} p.u.` : '—'],
    ['Reserve', status ? `${status.reserve_pct.toFixed(0)}%` : '—'],
  ];
  return (
    <Panel title="Live Grid Twin">
      <div className="flex items-center gap-5">
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-4 border-nc-renew/70 text-center">
          <div>
            <div className="text-xl font-semibold">{status ? `${status.stability_pct}%` : '—'}</div>
            <div className="text-[10px] text-nc-muted">Stability</div>
          </div>
        </div>
        <dl className="flex-1 space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-nc-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
