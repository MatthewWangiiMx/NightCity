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

/** Change over time, three measures on one MW axis. */
export default function DemandVsRenewables({
  steps,
  height = 190,
}: {
  steps: TimeStep[];
  height?: number;
}) {
  const rows = toRows(steps);

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
        <YAxis stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} width={46} unit="" />
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
          dataKey="demand"
          name="Total demand"
          stroke={SERIES.demand}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="renewables"
          name="Renewables"
          stroke={SERIES.renew}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="solar"
          name="Solar"
          stroke={SERIES.solar}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
