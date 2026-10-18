import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { localToLonLat } from '@/components/map/torontoLandmarks';
import type { BuildingElectricity } from '@/components/map/buildingElectricity';
import type { EwrbBuildingPlan, EwrbLevers, EwrbPlanDay } from '@/api/types';

/**
 * One building, today against the applied plan.
 *
 * Opens when a building is clicked on the results page. It runs the same lever
 * engine the district totals use, on this building alone, so the card can never
 * disagree with the totals it contributes to.
 */

const FUEL = {
  elec: 'var(--color-series-demand)',
  gas: 'var(--color-series-solar)',
} as const;

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Two columns on one scale: the comparison has to be readable at a glance. */
function CompareRow({
  label,
  unit,
  before,
  after,
  lowerIsBetter = true,
}: {
  label: string;
  unit: string;
  before: number | null | undefined;
  after: number | null | undefined;
  lowerIsBetter?: boolean;
}) {
  const pct =
    before && after != null && before !== 0 ? ((after - before) / before) * 100 : null;
  const good = pct == null ? false : lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <tr className="border-t border-nc-border/60">
      <td className="py-1.5 pr-2 text-[11px] text-nc-muted">
        {label}
        <span className="ml-1 text-[9px] text-nc-muted/70">{unit}</span>
      </td>
      <td className="py-1.5 text-right text-[11px] tabular-nums text-nc-muted">{num(before)}</td>
      <td className="py-1.5 pl-2 text-right text-[11px] font-semibold tabular-nums text-nc-text">
        {num(after)}
      </td>
      <td
        className={`py-1.5 pl-2 text-right text-[10px] tabular-nums ${
          good ? 'text-nc-renew' : pct ? 'text-nc-flex' : 'text-nc-muted'
        }`}
      >
        {pct == null ? '—' : `${pct > 0 ? '+' : ''}${num(pct, 0)}%`}
      </td>
    </tr>
  );
}

function FuelStrip({ elec, gas, label }: { elec: number; gas: number; label: string }) {
  const total = elec + gas || 1;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-nc-muted">
        <span>{label}</span>
        <span className="tabular-nums">{num(elec + gas)} MWh</span>
      </div>
      <div className="flex h-2 gap-0.5">
        <div
          className="rounded-l"
          style={{ width: `${(elec / total) * 100}%`, background: FUEL.elec }}
        />
        {gas / total > 0.01 && (
          <div
            className="rounded-r"
            style={{ width: `${(gas / total) * 100}%`, background: FUEL.gas }}
          />
        )}
      </div>
    </div>
  );
}

export default function BuildingPlanCompare({
  geometry,
  levers,
  day,
}: {
  geometry: BuildingElectricity;
  levers: Partial<EwrbLevers>;
  day?: Partial<EwrbPlanDay> | null;
}) {
  const [data, setData] = useState<EwrbBuildingPlan | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const requestId = useRef(0);

  const leverKey = JSON.stringify(levers);
  const dayKey = JSON.stringify(day ?? {});

  useEffect(() => {
    const token = ++requestId.current;
    setStatus('loading');
    setData(null);

    // The scene stores local metres; the cohort lookup wants lon/lat.
    const { lat, lon } = localToLonLat(0, 0);
    api
      .ewrbBuildingPlan(
        {
          id: geometry.id,
          name: geometry.name,
          kind: geometry.kind,
          footprint_m2: geometry.footprint_m2,
          height_m: geometry.height_m,
          levels: geometry.construction.floors_estimated ? null : geometry.floors,
          lat,
          lon,
        },
        levers,
        day,
      )
      .then((res) => {
        if (token !== requestId.current) return;
        setData(res);
        setStatus('ready');
      })
      .catch(() => {
        if (token !== requestId.current) return;
        setStatus('error');
      });
  }, [geometry.id, geometry.footprint_m2, geometry.kind, leverKey, dayKey]);

  const b = data?.building;
  const w = data?.weather;

  return (
    <div className="pointer-events-auto absolute right-4 top-20 z-20 max-h-[calc(100vh-7rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-nc-renew/40 bg-[#061018]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-[0.2em] text-nc-renew/90">
        Today vs your plan
      </div>
      <h2 className="mt-1 truncate text-lg font-semibold leading-tight text-nc-text">
        {geometry.name}
      </h2>
      <div className="mt-0.5 text-xs text-nc-muted">
        {b ? (
          <>
            {b.property_type}
            {b.fsa && ` · ${b.fsa}`} · {num(b.gross_floor_area_m2)} m²
          </>
        ) : (
          <span className="capitalize">{geometry.kind}</span>
        )}
      </div>

      {status === 'loading' && (
        <div className="mt-4 space-y-2" aria-busy>
          <div className="h-5 w-40 animate-pulse rounded bg-nc-panel-2" />
          <div className="h-24 w-full animate-pulse rounded bg-nc-panel-2" />
        </div>
      )}

      {status === 'error' && (
        <p className="mt-3 text-[11px] leading-snug text-nc-flex">
          No reported cohort matches this building, so it cannot be compared.
        </p>
      )}

      {status === 'ready' && data && b && (
        <>
          {b.site_eui_kwh_m2 != null && (
            <div className="mt-3 flex items-baseline gap-2 rounded-lg border border-nc-border/70 bg-nc-panel/40 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-nc-muted">
                Reported intensity
              </span>
              <span className="ml-auto tabular-nums text-nc-text">
                {num(b.site_eui_kwh_m2)}
                <span className="ml-1 text-[10px] text-nc-muted">kWh/m²·yr</span>
              </span>
              {b.percentile != null && (
                <span className="text-[10px] tabular-nums text-nc-muted">
                  · {num(b.percentile)}th pct
                </span>
              )}
            </div>
          )}

          {/* The comparison proper */}
          <table className="mt-3 w-full">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-nc-muted">
                <th className="pb-1 text-left font-medium">Metric</th>
                <th className="pb-1 text-right font-medium">Today</th>
                <th className="pb-1 pl-2 text-right font-medium text-nc-renew">Your plan</th>
                <th className="pb-1 pl-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow
                label="Site energy"
                unit="MWh/yr"
                before={data.baseline.site_mwh}
                after={data.planned.site_mwh}
              />
              <CompareRow
                label="Electricity"
                unit="MWh/yr"
                before={data.baseline.elec_mwh}
                after={data.planned.elec_mwh}
              />
              <CompareRow
                label="Gas"
                unit="MWh/yr"
                before={data.baseline.gas_mwh}
                after={data.planned.gas_mwh}
              />
              <CompareRow
                label="Emissions"
                unit="tCO₂e/yr"
                before={data.baseline.emissions_tco2e}
                after={data.planned.emissions_tco2e}
              />
              <CompareRow
                label="Electrified"
                unit="%"
                before={data.baseline.electrified_pct}
                after={data.planned.electrified_pct}
                lowerIsBetter={false}
              />
              {w?.available && (
                <CompareRow
                  label="On this day"
                  unit="MWh"
                  before={w.baseline_day_site_mwh}
                  after={w.day_site_mwh}
                />
              )}
            </tbody>
          </table>

          <div className="mt-3 space-y-2">
            <FuelStrip
              label="Today"
              elec={data.baseline.elec_mwh}
              gas={data.baseline.gas_mwh}
            />
            <FuelStrip
              label="Your plan"
              elec={data.planned.elec_mwh}
              gas={data.planned.gas_mwh}
            />
            <div className="flex gap-3 text-[10px] text-nc-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FUEL.elec }} />
                Electricity
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FUEL.gas }} />
                Gas
              </span>
            </div>
          </div>

          {data.breakdown.length > 0 && (
            <ul className="mt-3 space-y-0.5 border-t border-nc-border/60 pt-2">
              {data.breakdown.map((row) => (
                <li key={row.lever} className="flex items-baseline gap-2 text-[10px]">
                  <span className="text-nc-text">{row.label}</span>
                  <span className="ml-auto tabular-nums text-nc-renew">
                    {num(row.delta_site_mwh)} MWh
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[10px] leading-snug text-nc-muted/80">
            Intensity reported to Ontario EWRB by a comparable property; the plan is the same
            lever engine the district totals use. A cohort comparable, not this building's meter.
          </p>
        </>
      )}
    </div>
  );
}
