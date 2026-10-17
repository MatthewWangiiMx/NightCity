import { useState } from 'react';
import Panel from '@/components/Panel';
import { useEwrbFsaAreas, useEwrbLiveDistrict, useEwrbSummary } from '@/hooks/useEwrb';

/**
 * How much of the district's energy use is avoidable, measured against what
 * comparable Ontario buildings already report.
 *
 * This is the Plan page's one non-arbitrary lever. Elsewhere the page scales
 * figures by a chosen renewable share; here the target is a real percentile of
 * each building's own EWRB cohort, so the headroom is bounded by observed
 * practice rather than by an efficiency factor someone picked. No retrofit
 * measure is modelled - this is the gap to buildings that already exist.
 */

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Reported site EUI by postal FSA - a ranked bar, since the job is comparison. */
function FsaBars({
  areas,
  cityMedian,
}: {
  areas: { fsa: string; sample_size: number; site_eui_kwh_m2: number | null }[];
  cityMedian: number | null;
}) {
  const rows = areas
    .filter((a) => a.site_eui_kwh_m2 != null)
    .slice(0, 8)
    .sort((a, b) => (b.site_eui_kwh_m2 ?? 0) - (a.site_eui_kwh_m2 ?? 0));
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.site_eui_kwh_m2 ?? 0));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-nc-muted">
          Median site EUI by area
        </span>
        <span className="text-[10px] text-nc-muted">kWh/m²·yr</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const value = row.site_eui_kwh_m2 ?? 0;
          const aboveCity = cityMedian != null && value > cityMedian;
          return (
            <li key={row.fsa} className="flex items-center gap-2 text-[11px]">
              <span className="w-9 shrink-0 font-medium tabular-nums text-nc-text">
                {row.fsa}
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-nc-panel-2">
                {/* 4px rounded data-end, anchored to the baseline */}
                <span
                  className="absolute inset-y-0 left-0 rounded-r"
                  style={{
                    width: `${(value / max) * 100}%`,
                    background: aboveCity
                      ? 'var(--color-series-solar)'
                      : 'var(--color-series-demand)',
                  }}
                />
                {/* City median reference, ringed against the track */}
                {cityMedian != null && (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-nc-text/70"
                    style={{ left: `${(cityMedian / max) * 100}%` }}
                    title={`City median ${num(cityMedian)}`}
                  />
                )}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-nc-text">
                {num(value)}
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-nc-muted">
                n{row.sample_size}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-nc-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--color-series-solar)' }}
          />
          Above city median
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--color-series-demand)' }}
          />
          At or below
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-0.5 bg-nc-text/70" />
          City median {num(cityMedian)}
        </span>
      </div>
    </div>
  );
}

export default function EfficiencyHeadroomPanel({
  city = 'Toronto',
  className = '',
}: {
  city?: string;
  className?: string;
}) {
  const { summary, status } = useEwrbSummary(city);
  const { areas } = useEwrbFsaAreas(city);
  const { rollup, status: rollupStatus } = useEwrbLiveDistrict(city);
  const [showAll, setShowAll] = useState(false);

  const cityMedian = summary?.metrics.site_eui_kwh_m2?.median ?? null;
  const retrofit = rollup?.retrofit;
  const candidates = retrofit?.top_candidates ?? [];
  const shown = showAll ? candidates : candidates.slice(0, 5);

  if (status === 'unavailable') {
    return (
      <Panel
        title="Efficiency headroom"
        subtitle="Ontario EWRB — dataset not loaded"
        className={className}
      >
        <p className="text-[11px] leading-snug text-nc-muted">
          Add{' '}
          <code className="rounded bg-nc-panel-2 px-1">
            backend/data/odc_final_dataset_2024.csv
          </code>{' '}
          to hold each building to a percentile its own reported cohort already achieves.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Efficiency headroom"
      subtitle="Gap to what comparable reported buildings already achieve"
      className={className}
      actions={
        <span className="rounded bg-nc-renew/15 px-2 py-1 text-[10px] uppercase tracking-wide text-nc-renew">
          Measured basis
        </span>
      }
    >
      {/* Headline: the avoidable energy, as a hero pair rather than a chart */}
      {rollupStatus === 'ready' && retrofit ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-nc-renew/30 bg-nc-renew/[0.06] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-nc-muted">
              Avoidable energy
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-nc-renew">
              {num(retrofit.annual_saving_mwh)}
              <span className="ml-1 text-[10px] font-normal text-nc-muted">MWh/yr</span>
            </div>
          </div>
          <div className="rounded-lg border border-nc-renew/30 bg-nc-renew/[0.06] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-nc-muted">
              Avoidable emissions
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-nc-renew">
              {num(retrofit.annual_saving_tco2e)}
              <span className="ml-1 text-[10px] font-normal text-nc-muted">tCO₂e/yr</span>
            </div>
          </div>
          <p className="col-span-2 text-[10px] leading-snug text-nc-muted/90">
            If the {num(retrofit.buildings_above_target)} buildings above the{' '}
            {retrofit.target} dropped to it. {retrofit.assumption}
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-nc-muted">
          Absolute headroom needs floor area from TigerData massing, which is not loaded.
          The reported intensities below still rank every area.
        </p>
      )}

      {/* Worst offenders, where a plan would start */}
      {shown.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-nc-muted">
            Largest single gaps
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-nc-muted">
                <th className="pb-1 font-medium">Building</th>
                <th className="pb-1 text-right font-medium">Now</th>
                <th className="pb-1 text-right font-medium">Target</th>
                <th className="pb-1 text-right font-medium">MWh</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.building_id} className="border-t border-nc-border/60">
                  <td className="py-1 pr-2">
                    <div className="truncate text-nc-text">{row.name}</div>
                    <div className="truncate text-[10px] text-nc-muted">
                      {row.property_type}
                    </div>
                  </td>
                  <td className="py-1 text-right tabular-nums text-nc-text">
                    {num(row.current_site_eui_kwh_m2)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-nc-renew">
                    {num(row.target_site_eui_kwh_m2)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-nc-text">
                    {num(row.saving_mwh)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1.5 text-[10px] text-nc-muted underline-offset-2 transition hover:text-nc-text hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all ${candidates.length}`}
            </button>
          )}
        </div>
      )}

      {areas.length > 0 && <FsaBars areas={areas} cityMedian={cityMedian} />}
    </Panel>
  );
}
