import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { SERIES } from './chartParts';

/**
 * Composition of supply over the window.
 *
 * Three validated hues carry the renewable sources; the fossil remainder is
 * neutral, so it reads as "the rest" rather than a fourth identity. Every slice
 * is direct-labeled in the list beside the donut, so identity is never
 * colour-alone.
 */
const SLICE_COLOR: Record<string, string> = {
  Solar: SERIES.solar,
  Wind: SERIES.demand,
  Battery: SERIES.renew,
  'Natural gas': SERIES.neutral,
};

export default function EnergyMixDonut({
  mix,
  renewablePct,
  size = 150,
}: {
  mix: { name: string; share: number }[];
  renewablePct: number;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={mix}
              dataKey="share"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--color-nc-panel)"
              strokeWidth={2}
            >
              {mix.map((slice) => (
                <Cell key={slice.name} fill={SLICE_COLOR[slice.name] ?? SERIES.neutral} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--color-nc-bg)',
                border: '1px solid var(--color-nc-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xl font-semibold">{renewablePct}%</div>
            <div className="text-[10px] text-nc-muted">Renewables</div>
          </div>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 text-xs">
        {mix.map((slice) => (
          <li key={slice.name} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: SLICE_COLOR[slice.name] ?? SERIES.neutral }}
              aria-hidden
            />
            <span className="text-nc-muted">{slice.name}</span>
            <span className="ml-auto text-nc-text">{slice.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
