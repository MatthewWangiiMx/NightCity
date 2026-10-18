import { useEffect, useMemo, useState } from 'react';
import {
  fetchTorontoDailyForecast,
  isNotableWeatherDay,
  scenarioKindFromForecastDay,
  weatherCodeLabel,
  weatherEventTitle,
  type DailyForecastDay,
} from '@/api/openMeteo';
import type { ScenarioKind } from '@/api/types';

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLong(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}

export function useTorontoForecast() {
  const [days, setDays] = useState<DailyForecastDay[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchTorontoDailyForecast(16)
      .then((forecast) => {
        if (cancelled) return;
        setDays(forecast.days);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load forecast');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { days, status, error };
}

/** Full-page calendar: every day present in the Open-Meteo forecast. */
export function PlanWeatherDayPicker({
  days,
  status,
  error,
  onPick,
  title = 'Choose a plan day',
  subtitle = 'Toronto forecast from Open-Meteo — select a day to open the plan tools.',
  notableOnly = false,
  selected = null,
  confirmLabel,
  confirmLoading = false,
  onConfirm,
}: {
  days: DailyForecastDay[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  onPick: (day: DailyForecastDay) => void;
  title?: string;
  subtitle?: string;
  /** When true (Simulate), list notable weather events under the calendar. */
  notableOnly?: boolean;
  /** Highlighted day when using confirm-to-advance (Simulate). */
  selected?: DailyForecastDay | null;
  /** If set, day clicks only select — user must press this to continue. */
  confirmLabel?: string;
  confirmLoading?: boolean;
  onConfirm?: () => void;
}) {
  const needsConfirm = Boolean(confirmLabel);
  const available = useMemo(() => new Set(days.map((d) => d.date)), [days]);
  const [cursor, setCursor] = useState(() =>
    days[0] ? parseLocalDate(days[0].date) : new Date(),
  );

  useEffect(() => {
    if (days[0]) setCursor(parseLocalDate(days[0].date));
  }, [days]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toIsoDate(new Date(year, month, d)));
  }

  const canPrev = days.some((d) => {
    const dt = parseLocalDate(d.date);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    return dt.getFullYear() === prevYear && dt.getMonth() === prevMonth;
  });

  const canNext = days.some((d) => {
    const dt = parseLocalDate(d.date);
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    return dt.getFullYear() === nextYear && dt.getMonth() === nextMonth;
  });

  const byDate = useMemo(() => {
    const map = new Map<string, DailyForecastDay>();
    for (const day of days) map.set(day.date, day);
    return map;
  }, [days]);

  const notable = useMemo(
    () => days.filter(isNotableWeatherDay).slice(0, 6),
    [days],
  );

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-nc-text">{title}</h1>
          <p className="mt-1 text-sm text-nc-muted">{subtitle}</p>
        </div>

        {status === 'loading' && (
          <p className="text-center text-sm text-nc-muted">Loading forecast…</p>
        )}

        {status === 'error' && (
          <p className="text-center text-sm text-nc-alert">{error || 'Forecast unavailable.'}</p>
        )}

        {status === 'ready' && (
          <div className="rounded-xl border border-nc-border/80 bg-nc-panel/92 p-4 shadow-lg shadow-black/40 ring-1 ring-inset ring-white/5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => setCursor(new Date(year, month - 1, 1))}
                className="rounded-md border border-nc-border/70 px-2.5 py-1 text-xs text-nc-muted disabled:opacity-30 hover:border-nc-grid hover:text-nc-text"
              >
                Prev
              </button>
              <div className="text-sm font-medium text-nc-text">{formatMonthYear(cursor)}</div>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => setCursor(new Date(year, month + 1, 1))}
                className="rounded-md border border-nc-border/70 px-2.5 py-1 text-xs text-nc-muted disabled:opacity-30 hover:border-nc-grid hover:text-nc-text"
              >
                Next
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-nc-muted">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((iso, i) => {
                if (!iso) return <div key={`pad-${i}`} />;
                const ok = available.has(iso);
                const day = byDate.get(iso);
                const isSelected = Boolean(day && selected?.date === day.date);
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={!ok || !day}
                    title={
                      day
                        ? `${formatLong(iso)} · ${weatherCodeLabel(day.weatherCode)} · ${Math.round(day.tempMaxC)}° / ${Math.round(day.tempMinC)}°`
                        : undefined
                    }
                    onClick={() => day && onPick(day)}
                    className={[
                      'rounded-md py-2 text-sm tabular-nums transition',
                      !ok
                        ? 'cursor-not-allowed text-nc-muted/30'
                        : isSelected
                          ? 'bg-nc-renew text-nc-bg font-semibold'
                          : 'text-nc-text hover:bg-nc-grid hover:text-nc-bg',
                    ].join(' ')}
                  >
                    {parseLocalDate(iso).getDate()}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-center text-[10px] text-nc-muted">
              {days.length} days available ·{' '}
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
                className="text-nc-grid hover:underline"
              >
                Open-Meteo
              </a>
            </p>

            {notableOnly && notable.length > 0 && (
              <div className="mt-4 border-t border-nc-border/60 pt-4">
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-nc-muted">
                  Notable weather events
                </div>
                <div className="space-y-2">
                  {notable.map((day) => {
                    const kind = scenarioKindFromForecastDay(day);
                    const isSelected = selected?.date === day.date;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => onPick(day)}
                        className={[
                          'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition',
                          isSelected
                            ? 'border-nc-renew bg-nc-renew/10'
                            : 'border-nc-border hover:border-nc-grid hover:bg-nc-grid/10',
                        ].join(' ')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-nc-text">
                            {weatherEventTitle(day)}
                          </span>
                          <span className="block text-[11px] text-nc-muted">
                            {formatLong(day.date)} · {weatherCodeLabel(day.weatherCode)} ·{' '}
                            {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}° ·{' '}
                            {day.precipMm.toFixed(1)} mm
                          </span>
                        </span>
                        <span className="shrink-0 rounded bg-nc-alert/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-nc-alert">
                          {kind.replaceAll('_', ' ')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {notableOnly && notable.length === 0 && (
              <p className="mt-4 border-t border-nc-border/60 pt-4 text-center text-[11px] text-nc-muted">
                No thunderstorms or heat spikes in this window — pick any day on the calendar to
                simulate cloud cover or a mild disruption.
              </p>
            )}

            {needsConfirm && (
              <div className="mt-4 border-t border-nc-border/60 pt-4">
                {selected ? (
                  <p className="mb-3 text-center text-[11px] text-nc-muted">
                    Selected · {weatherEventTitle(selected)} · {formatLong(selected.date)}
                  </p>
                ) : (
                  <p className="mb-3 text-center text-[11px] text-nc-muted">
                    Select a day or weather event, then simulate.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!selected || confirmLoading}
                  onClick={() => onConfirm?.()}
                  className="w-full rounded-xl bg-nc-renew px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-nc-bg shadow-lg shadow-nc-renew/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {confirmLoading ? 'Preparing…' : confirmLabel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Slim top bar for the Simulate results view after a forecast day is chosen. */
export function SimulateWeatherEventBar({
  day,
  scenarioKind,
  loading,
  onChangeEvent,
}: {
  day: DailyForecastDay;
  scenarioKind: ScenarioKind;
  loading?: boolean;
  onChangeEvent: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-nc-border/70 bg-nc-panel/90 px-3 py-2 text-sm shadow-md shadow-black/30 ring-1 ring-inset ring-white/5">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Weather event</div>
        <div className="truncate font-medium text-nc-text">
          {weatherEventTitle(day)}
          {loading ? ' · running…' : ''}
        </div>
      </div>

      <div className="h-8 w-px bg-nc-border/70 max-sm:hidden" aria-hidden />

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Day</div>
        <div className="text-nc-text">{formatLong(day.date)}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Conditions</div>
        <div className="text-nc-text">{weatherCodeLabel(day.weatherCode)}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">High / low</div>
        <div className="tabular-nums text-nc-text">
          <span className="font-semibold">{Math.round(day.tempMaxC)}°</span>
          <span className="text-nc-muted"> / {Math.round(day.tempMinC)}°</span>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Scenario</div>
        <div className="text-nc-text">{scenarioKind.replaceAll('_', ' ')}</div>
      </div>

      <div className="ml-auto">
        <button
          type="button"
          onClick={onChangeEvent}
          className="rounded-md border border-nc-border/80 px-2.5 py-1 text-[11px] text-nc-text transition hover:border-nc-grid"
        >
          Change event
        </button>
      </div>
    </div>
  );
}

/** Slim top bar summarizing the selected day's Open-Meteo conditions. */
export function WeatherDayBar({
  day,
  onChangeDay,
}: {
  day: DailyForecastDay;
  onChangeDay: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-nc-border/70 bg-nc-panel/90 px-3 py-2 text-sm shadow-md shadow-black/30 ring-1 ring-inset ring-white/5">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Plan day</div>
        <div className="truncate font-medium text-nc-text">{formatLong(day.date)}</div>
      </div>

      <div className="h-8 w-px bg-nc-border/70 max-sm:hidden" aria-hidden />

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Conditions</div>
        <div className="text-nc-text">{weatherCodeLabel(day.weatherCode)}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">High / low</div>
        <div className="tabular-nums text-nc-text">
          <span className="font-semibold">{Math.round(day.tempMaxC)}°</span>
          <span className="text-nc-muted"> / {Math.round(day.tempMinC)}°</span>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Precip</div>
        <div className="tabular-nums text-nc-text">{day.precipMm.toFixed(1)} mm</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-nc-muted">Wind</div>
        <div className="tabular-nums text-nc-text">{Math.round(day.windMaxKmh)} km/h</div>
      </div>

      <div className="ml-auto">
        <button
          type="button"
          onClick={onChangeDay}
          className="rounded-md border border-nc-border/80 px-2.5 py-1 text-[11px] text-nc-text transition hover:border-nc-grid"
        >
          Change day
        </button>
      </div>
    </div>
  );
}
