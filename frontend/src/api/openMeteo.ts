/** Open-Meteo daily forecast for downtown Toronto (no API key; CORS-enabled). */

export const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

export type DailyForecastDay = {
  date: string; // YYYY-MM-DD
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  windMaxKmh: number;
};

export type DailyForecast = {
  timezone: string;
  days: DailyForecastDay[];
  source: 'open-meteo';
};

type OpenMeteoDailyResponse = {
  timezone?: string;
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
  };
};

/** WMO weather interpretation codes → short labels. */
export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed';
}

export async function fetchTorontoDailyForecast(forecastDays = 16): Promise<DailyForecast> {
  const params = new URLSearchParams({
    latitude: String(TORONTO.latitude),
    longitude: String(TORONTO.longitude),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'wind_speed_10m_max',
    ].join(','),
    timezone: 'America/Toronto',
    forecast_days: String(Math.min(16, Math.max(1, forecastDays))),
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = (await res.json()) as OpenMeteoDailyResponse;
  const daily = data.daily;
  if (!daily?.time?.length) throw new Error('Open-Meteo returned no daily forecast');

  const days: DailyForecastDay[] = daily.time.map((date, i) => ({
    date,
    weatherCode: daily.weather_code[i] ?? 0,
    tempMaxC: daily.temperature_2m_max[i] ?? 0,
    tempMinC: daily.temperature_2m_min[i] ?? 0,
    precipMm: daily.precipitation_sum[i] ?? 0,
    windMaxKmh: daily.wind_speed_10m_max[i] ?? 0,
  }));

  return {
    timezone: data.timezone ?? 'America/Toronto',
    days,
    source: 'open-meteo',
  };
}

