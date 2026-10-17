interface Props {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone?: 'neutral' | 'good' | 'warn';
}

const TONE = {
  neutral: 'text-nc-text',
  good: 'text-nc-renew',
  warn: 'text-nc-flex',
} as const;

export default function MetricTile({ label, value, unit, delta, tone = 'neutral' }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-nc-muted">{label}</span>
      <span className={`text-2xl font-semibold ${TONE[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-nc-muted">{unit}</span>}
      </span>
      {delta && <span className="text-xs text-nc-muted">{delta}</span>}
    </div>
  );
}
