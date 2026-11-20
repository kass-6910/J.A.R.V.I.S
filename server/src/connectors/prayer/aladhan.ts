import { DateTime } from "luxon";
import { config } from "../../config.js";

export const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

const API_KEYS: Record<PrayerName, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

/**
 * Horaires d'une réponse Aladhan vers des dates ISO 8601. Accepte le format ISO (iso8601=true)
 * comme le format court « 06:41 (CET) ». Pure : testée à part.
 */
export function parseAladhanTimings(body: unknown, day: string, zone: string): Record<PrayerName, string> {
  const timings = (body as { data?: { timings?: Record<string, string> } }).data?.timings;
  if (!timings) throw new Error("Réponse Aladhan sans horaires.");
  const out = {} as Record<PrayerName, string>;
  for (const name of PRAYER_NAMES) {
    const raw = timings[API_KEYS[name]];
    if (!raw) throw new Error(`Réponse Aladhan sans horaire pour ${API_KEYS[name]}.`);
    const iso = DateTime.fromISO(raw, { setZone: true });
    if (raw.includes("T") && iso.isValid) {
      out[name] = iso.toISO({ suppressMilliseconds: true })!;
      continue;
    }
    const match = raw.match(/(\d{1,2}):(\d{2})/);
    if (!match) throw new Error(`Horaire illisible pour ${API_KEYS[name]} : ${raw}`);
    out[name] = DateTime.fromISO(day, { zone })
      .set({ hour: Number(match[1]), minute: Number(match[2]) })
      .toISO({ suppressMilliseconds: true })!;
  }
  return out;
}

/** Horaires du jour (AAAA-MM-JJ) pour la position et la méthode configurées. */
export async function fetchPrayerTimes(day: string, zone: string): Promise<Record<PrayerName, string>> {
  const [y, m, d] = day.split("-");
  const params = new URLSearchParams({
    latitude: String(config.PRAYER_LATITUDE),
    longitude: String(config.PRAYER_LONGITUDE),
    method: String(config.PRAYER_METHOD),
    timezonestring: zone,
    iso8601: "true",
  });
  const res = await fetch(`https://api.aladhan.com/v1/timings/${d}-${m}-${y}?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Aladhan a répondu ${res.status} : ${await res.text()}`);
  return parseAladhanTimings(await res.json(), day, zone);
}
