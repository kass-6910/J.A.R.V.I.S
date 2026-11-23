import { config } from "../../config.js";

/** Météo du jour par Open-Meteo (gratuit, sans clé). */

export interface DayWeather {
  date: string;
  minC: number;
  maxC: number;
  /** Probabilité de pluie maximale de la journée, en %. */
  rainChance: number;
  summary: string;
}

/** Codes météo WMO → description courte. */
const CODES: [number[], string][] = [
  [[0], "ciel dégagé"],
  [[1, 2], "quelques nuages"],
  [[3], "couvert"],
  [[45, 48], "brouillard"],
  [[51, 53, 55, 56, 57], "bruine"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "pluie"],
  [[71, 73, 75, 77, 85, 86], "neige"],
  [[95, 96, 99], "orage"],
];

/** Réponse Open-Meteo (daily) vers le format de Jarvis, premier jour. Pure : testée à part. */
export function parseOpenMeteo(body: unknown): DayWeather {
  const daily = (body as { daily?: Record<string, unknown[]> }).daily;
  if (!daily?.time?.length) throw new Error("Réponse Open-Meteo sans prévision.");
  const code = Number(daily.weather_code?.[0] ?? daily.weathercode?.[0] ?? -1);
  return {
    date: String(daily.time[0]),
    minC: Math.round(Number(daily.temperature_2m_min?.[0])),
    maxC: Math.round(Number(daily.temperature_2m_max?.[0])),
    rainChance: Math.round(Number(daily.precipitation_probability_max?.[0] ?? 0)),
    summary: CODES.find(([codes]) => codes.includes(code))?.[1] ?? "temps variable",
  };
}

export async function fetchWeather(day: string, zone: string): Promise<DayWeather> {
  const params = new URLSearchParams({
    latitude: String(config.WEATHER_LATITUDE),
    longitude: String(config.WEATHER_LONGITUDE),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: zone,
    start_date: day,
    end_date: day,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status} : ${await res.text()}`);
  return parseOpenMeteo(await res.json());
}
