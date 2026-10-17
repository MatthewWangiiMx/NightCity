import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeStep } from '@/api/types';
import { AXIS, ChartTooltip, SERIES, eventMarker, toRows } from './chartParts';

/** Baseline vs plan on identical inputs. The baseline is a dashed reference. */
export default function GridLoadProfile({
  baseline,
  optimized,
  height = 200,
}: {
  baseline: TimeStep[];
  optimized: TimeStep[];
  height?: number;
}) {
  const rows = toRows(baseline, optimized);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 26, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={AXIS.stroke} strokeOpacity={0.35} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS.stroke}
          tick={AXIS.tick}
          interval={3}
          tickLine={false}
        />
        <YAxis stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} width={46} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS.stroke, strokeWidth: 1 }} />
        <Legend
          verticalAlign="bottom"
          height={24}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: '#7fa6b6' }}
        />
        <ReferenceLine
          x={eventMarker.x}
          stroke="var(--color-nc-alert)"
          strokeDasharray="4 4"
          label={{ value: eventMarker.label, fill: '#f05252', fontSize: 10, position: 'top', dy: -4 }}
        />
        <Line
          type="monotone"
          dataKey="baselineImport"
          name="Baseline"
          stroke={SERIES.neutral}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="planImport"
          name="NightCity plan"
          stroke={SERIES.renew}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
