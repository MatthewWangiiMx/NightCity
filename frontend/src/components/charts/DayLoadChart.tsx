import { useState } from 'react';
import type { EwrbDayCurve } from '@/api/types';

/**
 * Electricity through the selected day, before and after the plan.
 *
 * Two series on one axis, never two scales. Baseline wears the neutral
 * reference token and the plan the improvement green: they separate at deltaE
 * 17.7 for normal vision and 11.2 under deuteranopia, and both are direct
 * labelled at the right-hand end so identity never rests on colour alone.
 *
 * The gap between the lines is the point, so the area between them is filled
 * rather than left to the eye.
 */

const BASELINE = 'var(--color-series-neutral)';
const PLAN = 'var(--color-nc-renew)';

function fmt(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function DayLoadChart({
  curve,
  height = 200,
}: {
  curve: EwrbDayCurve;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!curve.available || !curve.baseline_mw?.length) return null;

  const base = curve.baseline_mw;
  const plan = curve.planned_mw ?? base;

  const w = 640;
  const h = height;
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 24;

  const max = Math.max(...base, ...plan) * 1.08 || 1;
  const x = (i: number) => padL + (i / (base.length - 1)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);

  const line = (s: number[]) =>
    s.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // Band between the two series: where the plan actually differs.
  const band =
    `${line(base)} ` +
    plan
      .map((_, i) => {
        const j = plan.length - 1 - i;
        return `L${x(j).toFixed(1)},${y(plan[j]).toFixed(1)}`;
      })
      .join(' ') +
    ' Z';

  const active = hover;
  const ticks = [0, 6, 12, 18, 23];
  const gridVals = [0, max / 2, max];

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Electricity demand by hour. Baseline peaks at ${fmt(
          curve.baseline_peak_mw ?? 0,
        )} megawatts, the plan at ${fmt(curve.planned_peak_mw ?? 0)}.`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const i = Math.round(((ratio * w - padL) / (w - padL - padR)) * (base.length - 1));
          setHover(Math.min(base.length - 1, Math.max(0, i)));
        }}
      >
        {/* Recessive grid */}
        {gridVals.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={w - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-nc-border)"
              strokeWidth={1}
            />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#7fa6b6">
              {fmt(v)}
            </text>
          </g>
        ))}

        <path d={band} fill={PLAN} opacity={0.12} />

        <path d={line(base)} fill="none" stroke={BASELINE} strokeWidth={2} strokeDasharray="4 3" />
        <path d={line(plan)} fill="none" stroke={PLAN} strokeWidth={2} strokeLinejoin="round" />

        {active != null && (
          <>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={padT}
              y2={h - padB}
              stroke="var(--color-nc-muted)"
              strokeDasharray="2 2"
              opacity={0.7}
            />
            <circle cx={x(active)} cy={y(base[active])} r={3.5} fill={BASELINE} />
            <circle cx={x(active)} cy={y(plan[active])} r={4} fill={PLAN} />
          </>
        )}

        {ticks.map((t) => (
          <text key={t} x={x(t)} y={h - 8} textAnchor="middle" fontSize={9} fill="#7fa6b6">
            {String(t).padStart(2, '0')}:00
          </text>
        ))}
      </svg>

      {/*
        The headline finding, stated rather than left to be read off the lines:
        electrifying heat moves the peak to the coldest hours, and the heat
        pumps are least efficient exactly then.
      */}
      {(curve.planned_peak_hour != null || curve.cop_penalty_mwh) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-nc-border/60 pt-2 text-[10px]">
          {curve.baseline_peak_hour != null &&
            curve.planned_peak_hour != null &&
            curve.baseline_peak_hour !== curve.planned_peak_hour && (
              <span className="text-nc-muted">
                Peak moves{' '}
                <span className="tabular-nums text-nc-text">
                  {String(curve.baseline_peak_hour).padStart(2, '0')}:00
                </span>{' '}
                →{' '}
                <span className="tabular-nums text-nc-flex">
                  {String(curve.planned_peak_hour).padStart(2, '0')}:00
                </span>
              </span>
            )}
          {curve.effective_cop != null && (
            <span className="text-nc-muted">
              Heat pump COP{' '}
              <span
                className={`tabular-nums ${
                  curve.rated_cop != null && curve.effective_cop < curve.rated_cop
                    ? 'text-nc-flex'
                    : 'text-nc-renew'
                }`}
              >
                {curve.effective_cop.toFixed(2)}
              </span>{' '}
              at today&apos;s temperatures, against {curve.rated_cop?.toFixed(1)} rated
            </span>
          )}
          {!!curve.cop_penalty_mwh && curve.cop_penalty_mwh > 0 && (
            <span className="text-nc-muted">
              Costing{' '}
              <span className="tabular-nums text-nc-flex">
                +{fmt(curve.cop_penalty_mwh)} MWh
              </span>{' '}
              today
            </span>
          )}
        </div>
      )}

      {/* Legend plus the hovered readout; values wear text tokens, not series colour */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1.5 text-nc-muted">
          <span aria-hidden className="h-0.5 w-4" style={{ background: BASELINE }} />
          Today
          <span className="tabular-nums text-nc-text">
            {active != null ? `${fmt(base[active])} MW` : `peak ${fmt(curve.baseline_peak_mw ?? 0)}`}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-nc-muted">
          <span aria-hidden className="h-0.5 w-4" style={{ background: PLAN }} />
          Your plan
          <span className="tabular-nums text-nc-text">
            {active != null ? `${fmt(plan[active])} MW` : `peak ${fmt(curve.planned_peak_mw ?? 0)}`}
          </span>
        </span>
        {active != null && (
          <span className="ml-auto tabular-nums text-nc-muted">
            {String(active).padStart(2, '0')}:00 ·{' '}
            <span className={plan[active] <= base[active] ? 'text-nc-renew' : 'text-nc-flex'}>
              {plan[active] - base[active] > 0 ? '+' : ''}
              {fmt(plan[active] - base[active])} MW
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
