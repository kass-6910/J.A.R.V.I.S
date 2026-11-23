import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { fetchPrayerTimes, PRAYER_NAMES, type PrayerName } from "../connectors/prayer/aladhan.js";
import { fetchDailyHadith, type Hadith } from "../connectors/prayer/hadith.js";
import { db } from "../db/client.js";
import { dailyHadith, prayerTimes, scheduleBlocks } from "../db/schema.js";
import { now, zone } from "../lib/time.js";
import { getValue, setValue } from "./kv.js";

export const PRAYER_LABEL: Record<PrayerName, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export type PrayerDay = Record<PrayerName, Date>;

/** Horaires d'un jour : en base s'ils y sont (même méthode de calcul), sinon demandés à Aladhan. */
export async function getPrayerTimes(day: DateTime): Promise<PrayerDay | null> {
  if (!config.PRAYER_ENABLED) return null;
  const iso = day.toISODate()!;
  const cached = await db.query.prayerTimes.findFirst({ where: eq(prayerTimes.day, iso) });
  let timings = cached?.method === config.PRAYER_METHOD ? cached.timings : null;
  if (!timings) {
    try {
      timings = await fetchPrayerTimes(iso, zone);
    } catch (err) {
      console.error(`Horaires de prière du ${iso} indisponibles :`, err);
      return null;
    }
    await db
      .insert(prayerTimes)
      .values({ day: iso, timings, method: config.PRAYER_METHOD })
      .onConflictDoUpdate({ target: prayerTimes.day, set: { timings, method: config.PRAYER_METHOD, fetchedAt: new Date() } });
  }
  return Object.fromEntries(PRAYER_NAMES.map((name) => [name, new Date(timings[name])])) as PrayerDay;
}

/**
 * Place les cinq prières du jour comme créneaux protégés : le planificateur organise
 * les tâches autour. Idempotent (un seul créneau par prière et par jour).
 */
export async function ensurePrayerBlocks(day: DateTime): Promise<void> {
  const times = await getPrayerTimes(day);
  if (!times) return;
  const iso = day.toISODate()!;
  const length = config.PRAYER_DURATION_MIN * 60_000;
  await db
    .insert(scheduleBlocks)
    .values(
      PRAYER_NAMES.map((name) => ({
        day: iso,
        kind: "prayer" as const,
        title: `Prière ${PRAYER_LABEL[name]}`,
        startsAt: times[name],
        endsAt: new Date(times[name].getTime() + length),
        protected: true,
      })),
    )
    .onConflictDoNothing();
}

/** Notification quelques minutes avant chaque prière, une seule fois. */
export async function notifyUpcomingPrayers(): Promise<void> {
  if (!config.PRAYER_ENABLED || !isNotifyConfigured()) return;
  const current = now();
  const iso = current.toISODate()!;
  const blocks = await db
    .select()
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.day, iso), eq(scheduleBlocks.kind, "prayer")));
  const horizon = current.toMillis() + config.PRAYER_NOTIFY_BEFORE_MIN * 60_000;
  for (const block of blocks) {
    const at = block.startsAt.getTime();
    // Fenêtre : de « N minutes avant » jusqu'à l'heure de la prière (rattrapage après un redémarrage).
    if (at > horizon || at < current.toMillis() - 60_000) continue;
    const key = `prayer_notified:${iso}:${block.title}`;
    if (await getValue(key)) continue;
    const minutes = Math.max(0, Math.round((at - current.toMillis()) / 60_000));
    await sendNotification({
      title: block.title,
      message: minutes > 0 ? `Dans ${minutes} min, à ${DateTime.fromJSDate(block.startsAt, { zone }).toFormat("HH:mm")}.` : "C'est l'heure.",
      priority: 4,
      tags: ["crescent_moon"],
    });
    await setValue(key, new Date().toISOString());
  }
}

/** Rappel du jour : un hadith d'un recueil publié, cité avec sa référence. Null si la source ne répond pas. */
export async function getDailyHadith(day: DateTime = now()): Promise<Hadith | null> {
  const iso = day.toISODate()!;
  const cached = await db.query.dailyHadith.findFirst({ where: eq(dailyHadith.day, iso) });
  if (cached) return cached;
  const editions = config.HADITH_EDITIONS.split(",").map((e) => e.trim()).filter(Boolean);
  let hadith: Hadith | null = null;
  try {
    hadith = await fetchDailyHadith(iso, editions);
  } catch (err) {
    console.error("Rappel du jour indisponible :", err);
  }
  if (hadith) await db.insert(dailyHadith).values({ day: iso, ...hadith }).onConflictDoNothing();
  return hadith;
}

/** Préparation : horaires d'aujourd'hui et de demain, rappel du jour. Lancé chaque heure. */
export async function prefetchPrayerData(): Promise<void> {
  if (!config.PRAYER_ENABLED) return;
  const today = now().startOf("day");
  await ensurePrayerBlocks(today);
  await getPrayerTimes(today.plus({ days: 1 }));
  await getDailyHadith(today);
}

export function describeHadith(h: Hadith): string {
  return `« ${h.text} » (${h.collection}, n° ${h.number}${h.grade ? `, ${h.grade}` : ""})`;
}
