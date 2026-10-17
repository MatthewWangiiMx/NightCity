import { useState } from 'react';
import type { EwrbBuildingProfile } from '@/api/types';
import type { BuildingElectricity } from '@/components/map/buildingElectricity';

/**
 * The panel that opens when you click a building in the city.
 *
 * Its organising idea is the line between measured and derived. The top block
 * is what an operator actually filed with Ontario's EWRB programme; the bottom
 * is what we computed from it and from the building's massing. They are marked
 * differently on purpose - a solid accent dot for reported, a hollow one for
 * derived - because a viewer who cannot tell them apart will trust the wrong
 * number.
 *
 * Geometry renders immediately from the raycast hit; the reported half arrives
 * a moment later and the panel never blocks on it.
 */

// Categorical slots, validated against --color-nc-panel for CVD separation.
// Fixed order, assigned per entity: electricity always blue, gas always amber.
const FUEL = {
  electricity: 'var(--color-series-demand)',
  gas: 'var(--color-series-solar)',
} as const;

// End uses: the first two are categorical slots, plug load is the documented
// remainder token and so is always direct-labeled.
const END_USE = {
  hvac: 'var(--color-series-demand)',
  lighting: 'var(--color-series-solar)',
  plug: 'var(--color-series-neutral)',
} as const;

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function basisLabel(basis: string, scope: string): string {
  const area = scope.split(':')[1] ?? scope;
  if (basis === 'fsa') return `comparable buildings in ${area}`;
  if (basis === 'city') return `comparable buildings in ${area}`;
  return 'comparable buildings across Ontario';
}

/** Section heading that marks which side of the measured/derived line we're on. */
function SectionHead({
  kind,
  title,
  detail,
}: {
  kind: 'reported' | 'derived';
  title: string;
  detail: string;
}) {
  const reported = kind === 'reported';
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
          reported ? 'bg-nc-renew' : 'border border-nc-muted/70 bg-transparent'
        }`}
      />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nc-text/90">
          {title}
        </div>
        <div className="text-[10px] leading-snug text-nc-muted">{detail}</div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-nc-border/70 bg-nc-panel/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-nc-muted">{label}</div>
      <div className={`mt-0.5 tabular-nums ${accent ? 'text-cyan-300' : 'text-nc-text'}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] text-nc-muted">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Where this building sits in its cohort's reported range.
 *
 * A strip, not a bar chart: one measure, a p25-p75 box for the middle half,
 * a median tick, and this building's marker. Lower is leaner, so the strip
 * reads left-to-right as better-to-worse and says so.
 */
function CohortStrip({
  value,
  min,
  max,
  p25,
  median,
  p75,
  percentile,
}: {
  value: number;
  min: number;
  max: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  percentile: number | null;
}) {
  const lo = Math.min(min, value);
  const hi = Math.max(max, value);
  const span = hi - lo || 1;
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;

  return (
    <div className="mt-2">
      <div className="relative h-7">
        {/* Full reported range */}
        <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-nc-panel-2" />
        {/* Middle half of the cohort */}
        {p25 != null && p75 != null && (
          <div
            className="absolute top-2.5 h-2 rounded-full bg-nc-border"
            style={{ left: pct(p25), width: `calc(${pct(p75)} - ${pct(p25)})` }}
            title={`Middle half of the cohort: ${num(p25)}–${num(p75)} kWh/m²·yr`}
          />
        )}
        {/* Cohort median */}
        {median != null && (
          <div
            className="absolute top-1.5 h-4 w-0.5 -translate-x-1/2 bg-nc-muted"
            style={{ left: pct(median) }}
            title={`Cohort median ${num(median)} kWh/m²·yr`}
          />
        )}
        {/* This building, ringed against the surface so it reads over the box */}
        <div
          className="absolute top-1 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-nc-panel bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.6)]"
          style={{ left: pct(value) }}
          title={`This building ${num(value)} kWh/m²·yr`}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-nc-muted">
        <span title="5th percentile of the cohort">{num(lo)} lean</span>
        {median != null && <span>median {num(median)}</span>}
        <span title="95th percentile of the cohort">{num(hi)} heavy</span>
      </div>
      {percentile != null && (
        <p className="mt-1.5 text-[11px] leading-snug text-nc-text/90">
          Uses{' '}
          <span className="font-semibold text-cyan-300">
            more than {num(percentile)}%
          </span>{' '}
          of comparable buildings per m².
        </p>
      )}
    </div>
  );
}

/**
 * Reported fuel split, measured against site energy rather than against
 * electricity-plus-gas.
 *
 * Filers often report site energy while withholding the gas line. Dividing by
 * the fuels present would then show such a building as 100% electric, when in
 * fact most of its energy is simply unaccounted for. So the remainder gets its
 * own segment and says what it is.
 */
function FuelSplit({
  elec,
  gas,
  siteEui,
}: {
  elec: number | null;
  gas: number | null;
  siteEui: number | null;
}) {
  const e = elec ?? 0;
  const g = gas ?? 0;
  const total = siteEui && siteEui > e + g ? siteEui : e + g;
  if (total <= 0) return null;

  const elecPct = (e / total) * 100;
  const gasPct = (g / total) * 100;
  const restPct = Math.max(0, 100 - elecPct - gasPct);

  const segments = [
    { key: 'elec', pct: elecPct, color: FUEL.electricity },
    { key: 'gas', pct: gasPct, color: FUEL.gas },
    { key: 'rest', pct: restPct, color: 'var(--color-series-neutral)' },
  ].filter((s) => s.pct > 0.5);

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-nc-muted">
          Reported fuel split
        </span>
        <span className="text-[10px] text-nc-muted">kWh/m²·yr</span>
      </div>
      {/* 2px surface gap between fills, per the mark spec */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-nc-panel-2">
        {segments.map((s, i) => (
          <div
            key={s.key}
            className={
              i === 0 ? 'rounded-l-full' : i === segments.length - 1 ? 'rounded-r-full' : ''
            }
            style={{ width: `${s.pct}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[10px] text-nc-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: FUEL.electricity }}
          />
          Electricity {num(elec, 0)}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FUEL.gas }} />
          Gas {gas == null ? 'not reported' : num(gas, 0)}
        </span>
        {restPct > 0.5 && (
          <span
            className="flex items-center gap-1.5"
            title="Site energy the filing does not break down by fuel"
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: 'var(--color-series-neutral)' }}
            />
            Unattributed {num((restPct / 100) * total, 0)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Modelled 24-hour electrical demand.
 *
 * One series, so no legend - the heading names it. Carries a hover readout
 * because an area chart without one hides every value but the peak.
 */
function DemandCurve({
  curve,
  nowHour,
  peakKw,
}: {
  curve: number[];
  nowHour: number;
  peakKw: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!curve.length) return null;

  const w = 288;
  const h = 56;
  const max = Math.max(...curve, peakKw) || 1;
  const x = (i: number) => (i / (curve.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 6) - 2;

  const line = curve.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const active = hover ?? nowHour;

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-nc-muted">
          Modelled demand through the day
        </span>
        <span className="tabular-nums text-[11px] text-nc-text">
          {num(curve[active % 24], 0)} kW
          <span className="ml-1 text-nc-muted">
            @ {String(active % 24).padStart(2, '0')}:00
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-14 w-full touch-none"
        role="img"
        aria-label={`Modelled electrical demand by hour, peaking at ${num(peakKw)} kilowatts`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          setHover(Math.min(23, Math.max(0, Math.round(ratio * 23))));
        }}
      >
        <defs>
          <linearGradient id="nc-demand-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-series-demand)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--color-series-demand)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#nc-demand-fill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--color-series-demand)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Crosshair at the hovered hour, or the current hour at rest */}
        <line
          x1={x(active % 24)}
          x2={x(active % 24)}
          y1={0}
          y2={h}
          stroke="var(--color-nc-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.7}
        />
        <circle
          cx={x(active % 24)}
          cy={y(curve[active % 24])}
          r={4}
          fill="var(--color-series-demand)"
          stroke="var(--color-nc-panel)"
          strokeWidth={2}
        />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-nc-muted">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

/** Modelled electricity end-use split; every segment direct-labeled. */
function EndUseSplit({
  hvac,
  lighting,
  plug,
}: {
  hvac: number;
  lighting: number;
  plug: number;
}) {
  const rows = [
    { key: 'hvac', label: 'HVAC', pct: hvac, color: END_USE.hvac },
    { key: 'lighting', label: 'Lighting', pct: lighting, color: END_USE.lighting },
    { key: 'plug', label: 'Plug loads', pct: plug, color: END_USE.plug },
  ];
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-nc-muted">
        Modelled electricity end uses
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-nc-panel-2">
        {rows.map((r, i) => (
          <div
            key={r.key}
            className={i === 0 ? 'rounded-l-full' : i === rows.length - 1 ? 'rounded-r-full' : ''}
            style={{ width: `${r.pct}%`, background: r.color }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-nc-muted">
        {rows.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: r.color }} />
            {r.label} {r.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BuildingEnergyPanel({
  geometry,
  profile,
  status,
  onClose,
}: {
  /** Known the instant the raycast lands, so the panel can open without waiting. */
  geometry: BuildingElectricity;
  profile: EwrbBuildingProfile | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  onClose: () => void;
}) {
  const intensity = profile?.intensity;
  const bench = profile?.benchmark;
  const eui = intensity?.site_eui_kwh_m2 ?? null;

  return (
    <div className="pointer-events-auto absolute right-4 top-20 z-20 max-h-[calc(100vh-7rem)] w-[min(23rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-cyan-400/40 bg-[#061018]/95 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur-md">
      {/* Header: identity from the massing, property type from the cohort match */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">Grid node</div>
          <h2 className="mt-1 truncate text-lg font-semibold leading-tight text-nc-text">
            {geometry.name}
          </h2>
          <div className="mt-1 text-xs text-nc-muted">
            {profile?.property_type ?? <span className="capitalize">{geometry.kind}</span>}
            {profile?.fsa && ` · ${profile.fsa}`}
            {' · '}
            {num(profile?.levels ?? geometry.floors)} floors
            {(profile?.floors_estimated ?? geometry.construction.floors_estimated) ? ' (est.)' : ''}
            {geometry.height_m ? ` · ${num(geometry.height_m)} m` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-nc-border px-2 py-1 text-[11px] text-nc-muted transition hover:border-nc-renew hover:text-nc-text"
        >
          Close
        </button>
      </div>

      {/* ---------- Reported: filed with the province ---------- */}
      <div className="mt-4 rounded-xl border border-nc-renew/25 bg-nc-renew/[0.04] p-3">
        <SectionHead
          kind="reported"
          title="Reported"
          detail={
            bench
              ? `Ontario EWRB · ${bench.sample_size} ${basisLabel(bench.basis, bench.scope)}`
              : 'Ontario EWRB benchmarking programme'
          }
        />

        {status === 'loading' && (
          <div className="mt-3 space-y-2" aria-busy>
            <div className="h-7 w-32 animate-pulse rounded bg-nc-panel-2" />
            <div className="h-7 w-full animate-pulse rounded bg-nc-panel-2" />
          </div>
        )}

        {status === 'unavailable' && (
          <p className="mt-2 text-[11px] leading-snug text-nc-flex">
            No reported benchmark for this building. The EWRB dataset is optional — add
            <code className="mx-1 rounded bg-nc-panel-2 px-1">backend/data/odc_final_dataset_2024.csv</code>
            to enable it.
          </p>
        )}

        {status === 'ready' && intensity && bench && (
          <>
            {eui != null ? (
              <>
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-nc-muted">
                    Site energy intensity
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums text-cyan-300">
                      {num(eui)}
                    </span>
                    <span className="text-[11px] text-nc-muted">kWh/m²·yr</span>
                  </div>
                </div>
                <CohortStrip
                  value={eui}
                  min={bench.cohort_min_site_eui ?? eui}
                  max={bench.cohort_max_site_eui ?? eui}
                  p25={bench.cohort_p25_site_eui}
                  median={bench.cohort_median_site_eui}
                  p75={bench.cohort_p75_site_eui}
                  percentile={bench.site_eui_percentile}
                />
              </>
            ) : (
              <p className="mt-2 text-[11px] text-nc-muted">
                Site energy intensity was not reported for this cohort.
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Metric
                label="ENERGY STAR"
                value={intensity.energy_star_score != null ? num(intensity.energy_star_score) : '—'}
                unit={intensity.energy_star_score != null ? '/100' : undefined}
                accent
              />
              <Metric label="Emissions" value={num(intensity.ghg_kg_m2, 1)} unit="kg CO₂e/m²" />
              <Metric label="Source energy" value={num(intensity.source_eui_kwh_m2)} unit="kWh/m²" />
              <Metric label="Water" value={num(intensity.water_m3_m2, 2)} unit="m³/m²" />
            </div>

            <FuelSplit
              elec={intensity.elec_kwh_m2}
              gas={intensity.gas_kwh_m2}
              siteEui={intensity.site_eui_kwh_m2}
            />

            {intensity.electrification_pct != null && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-xs">
                <span className="text-nc-muted">Electrified share of site energy</span>
                <span className="font-semibold tabular-nums text-nc-renew">
                  {num(intensity.electrification_pct, 0)}%
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------- Derived: reported intensity x this building's area ---------- */}
      <div className="mt-3 rounded-xl border border-nc-border/70 bg-nc-panel/30 p-3">
        <SectionHead
          kind="derived"
          title="Derived for this building"
          detail={
            profile
              ? `${num(profile.gross_floor_area_m2)} m² floor area × the reported intensity above`
              : `${num(geometry.footprint_m2)} m² footprint`
          }
        />

        {status === 'ready' && profile ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Metric label="Annual electricity" value={num(profile.annual.elec_mwh)} unit="MWh" accent />
              <Metric label="Annual emissions" value={num(profile.annual.emissions_tco2e)} unit="tCO₂e" />
              <Metric label="Peak demand" value={num(profile.demand.peak_kw)} unit="kW" />
              <Metric label="Flexible now" value={num(profile.demand.flexible_kw)} unit="kW" />
            </div>

            <DemandCurve
              curve={profile.demand.curve_kw}
              nowHour={profile.demand.at_hour}
              peakKw={profile.demand.peak_kw}
            />

            <EndUseSplit
              hvac={profile.demand.hvac_share_pct}
              lighting={profile.demand.lighting_share_pct}
              plug={profile.demand.plug_share_pct}
            />

            <div className="mt-3 flex items-center justify-between rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-xs">
              <span className="text-nc-muted">Load factor</span>
              <span className="font-semibold tabular-nums text-nc-grid">
                {num(profile.demand.load_factor_pct)}%
              </span>
            </div>
          </>
        ) : (
          /* Massing-only fallback: geometry is real, the load estimate is not */
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="Footprint" value={num(geometry.footprint_m2)} unit="m²" />
            <Metric label="Levels" value={num(geometry.floors)} />
            <Metric label="Avg height" value={num(geometry.construction.avg_h ?? geometry.height_m, 1)} unit="m" />
            <Metric label="Max height" value={num(geometry.construction.max_h, 1)} unit="m" />
          </div>
        )}
      </div>

      {/* ---------- Provenance ---------- */}
      <div className="mt-3 space-y-1.5 rounded-lg border border-nc-border/80 bg-nc-panel/50 px-3 py-2 text-[10px] leading-snug">
        <div className="flex justify-between gap-3">
          <span className="text-nc-muted">Footprint source</span>
          <span className="text-right text-cyan-200/90">
            {geometry.construction.data_source === 'tigerdata' ? 'TigerData' : 'Massing cache'}
          </span>
        </div>
        {geometry.construction.height_src && (
          <div className="flex justify-between gap-3">
            <span className="text-nc-muted">Height source</span>
            <span className="text-right text-nc-text">{geometry.construction.height_src}</span>
          </div>
        )}
        {bench?.comparable_ewrb_id && (
          <div className="flex justify-between gap-3">
            <span className="text-nc-muted">Comparable EWRB ID</span>
            <span className="text-right tabular-nums text-nc-text">
              {bench.comparable_ewrb_id}
              {bench.data_quality_checked && (
                <span className="ml-1 text-nc-renew" title="Operator ran the data-quality check">
                  ✓
                </span>
              )}
            </span>
          </div>
        )}
        {bench != null && bench.cohort_excluded_filings > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-nc-muted">Filings screened out</span>
            <span
              className="text-right tabular-nums text-nc-flex"
              title="Reported values outside the physical range for this metric — likely totals entered in an intensity column"
            >
              {bench.cohort_excluded_filings}
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-nc-muted/80">
        {profile ? (
          <>
            <span className="text-nc-renew">Measured:</span> {profile.provenance.measured}{' '}
            <span className="text-nc-muted">Derived:</span> {profile.provenance.modelled}{' '}
            {profile.provenance.caveat}
          </>
        ) : (
          <>
            Heights and footprint from City of Toronto 3D Massing via{' '}
            {geometry.construction.data_source === 'tigerdata' ? 'TigerData' : 'local cache'}.
            Load figures are simulated, not metered.
          </>
        )}
      </p>
    </div>
  );
}
