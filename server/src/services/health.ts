import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { healthDays, workouts } from "../db/schema.js";
import type { HealthImport } from "../health/ingest.js";
import { sessionFor, shouldScheduleSport } from "../health/sport.js";
import { formatTime, now, zone } from "../lib/time.js";

export type HealthDay = typeof healthDays.$inferSelect;
export type Workout = typeof workouts.$inferSelect;

/** Enregistre un export Santé. Les champs absents ne remplacent pas ceux déjà connus. */
export async function ingestHealth(data: HealthImport): Promise<{ days: number; workouts: number }> {
  for (const d of data.days) {
    const values = {
      day: d.day,
      steps: d.steps ?? null,
      activeKcal: d.activeKcal ?? null,
      sleepMin: d.sleepMin ?? null,
      sleepStart: d.sleepStart ?? null,
      sleepEnd: d.sleepEnd ?? null,
    };
    await db
      .insert(healthDays)
      .values(values)
      .onConflictDoUpdate({
        target: healthDays.day,
        set: {
          steps: sql`coalesce(excluded.steps, ${healthDays.steps})`,
          activeKcal: sql`coalesce(excluded.active_kcal, ${healthDays.activeKcal})`,
          sleepMin: sql`coalesce(excluded.sleep_min, ${healthDays.sleepMin})`,
          sleepStart: sql`coalesce(excluded.sleep_start, ${healthDays.sleepStart})`,
          sleepEnd: sql`coalesce(excluded.sleep_end, ${healthDays.sleepEnd})`,
          updatedAt: new Date(),
        },
      });
  }
  let added = 0;
  if (data.workouts.length > 0) {
    const inserted = await db.insert(workouts).values(data.workouts).onConflictDoNothing().returning({ id: workouts.id });
    added = inserted.length;
  }
  return { days: data.days.length, workouts: added };
}

/** Séance déclarée à la main (« Jarvis, j'ai fait ma séance »), quand la montre n'a rien envoyé. */
export async function logWorkout(input: { type?: string; minutes?: number; endsAt?: Date }): Promise<Workout> {
  const endsAt = input.endsAt ?? new Date();
  const startsAt = new Date(endsAt.getTime() - (input.minutes ?? config.SPORT_DURATION_MIN) * 60_000);
  const [row] = await db
    .insert(workouts)
    .values({ type: input.type ?? "Séance déclarée", startsAt, endsAt })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new Error("Cette séance est déjà enregistrée.");
  return row;
}

export async function workoutsBetween(from: DateTime, to: DateTime): Promise<Workout[]> {
  return db
    .select()
    .from(workouts)
    .where(and(gte(workouts.startsAt, from.toJSDate()), lt(workouts.startsAt, to.toJSDate())))
    .orderBy(asc(workouts.startsAt));
}

export async function getHealthDay(day: DateTime): Promise<HealthDay | null> {
  return (await db.query.healthDays.findFirst({ where: eq(healthDays.day, day.toISODate()!) })) ?? null;
}

/** Jours où une séance a eu lieu (plusieurs séances le même jour comptent pour une). */
function sessionDays(list: Workout[]): Set<string> {
  return new Set(list.map((w) => DateTime.fromJSDate(w.startsAt, { zone }).toISODate()!));
}

export interface SportWeekStatus {
  target: number;
  done: number;
  doneToday: boolean;
  /** Jours de la semaine (lundi → dimanche) avec une séance. */
  days: string[];
}

export async function sportWeek(day: DateTime): Promise<SportWeekStatus> {
  const monday = day.startOf("week");
  const days = sessionDays(await workoutsBetween(monday, day.plus({ days: 1 }).startOf("day")));
  return {
    target: config.SPORT_SESSIONS_PER_WEEK,
    done: days.size,
    doneToday: days.has(day.toISODate()!),
    days: [...days].sort(),
  };
}

/** Séance à placer aujourd'hui, ou null (objectif atteint, jour de repos, séance déjà faite). */
export async function sportSessionFor(day: DateTime): Promise<{ title: string; durationMin: number } | null> {
  if (config.SPORT_SESSIONS_PER_WEEK === 0) return null;
  const week = await sportWeek(day);
  const yesterday = day.minus({ days: 1 }).toISODate()!;
  const didYesterday =
    week.days.includes(yesterday) ||
    // Le lundi, la veille appartient à la semaine précédente.
    (day.weekday === 1 && sessionDays(await workoutsBetween(day.minus({ days: 1 }), day)).size > 0);
  const due = shouldScheduleSport({
    target: week.target,
    doneThisWeek: week.done,
    doneToday: week.doneToday,
    didYesterday,
    daysLeft: 8 - day.weekday,
  });
  if (!due) return null;
  const health = await getHealthDay(day);
  return sessionFor(health?.sleepMin ?? null, config.SPORT_DURATION_MIN);
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Heure de coucher en minutes depuis 18 h, pour comparer des nuits qui passent minuit. */
function bedtimeMinutes(date: Date): number {
  const dt = DateTime.fromJSDate(date, { zone });
  return ((dt.hour - 18 + 24) % 24) * 60 + dt.minute;
}

/** Lignes de faits Santé pour le briefing : nuit, activité de la veille, sport de la semaine. */
export async function healthFacts(day: DateTime, kind: "morning" | "evening"): Promise<string[]> {
  const [nights, week] = await Promise.all([
    db
      .select()
      .from(healthDays)
      .where(and(gte(healthDays.day, day.minus({ days: 7 }).toISODate()!), lt(healthDays.day, day.plus({ days: 1 }).toISODate()!)))
      .orderBy(desc(healthDays.day)),
    sportWeek(day),
  ]);
  if (nights.length === 0 && week.done === 0) {
    return ["Santé : aucune donnée de la montre reçue pour l'instant."];
  }
  const lines: string[] = ["Santé :"];
  const today = nights.find((n) => n.day === day.toISODate());
  const activityDay = kind === "morning" ? nights.find((n) => n.day === day.minus({ days: 1 }).toISODate()) : today;

  if (kind === "morning") {
    if (today?.sleepMin) {
      let line = `- nuit dernière : ${hours(today.sleepMin)} de sommeil`;
      if (today.sleepStart) {
        line += `, couché à ${formatTime(today.sleepStart)}`;
        const previous = nights.filter((n) => n.day !== today.day && n.sleepStart).map((n) => bedtimeMinutes(n.sleepStart!));
        if (previous.length >= 3) {
          const average = previous.reduce((a, b) => a + b, 0) / previous.length;
          const gap = Math.round(bedtimeMinutes(today.sleepStart) - average);
          if (Math.abs(gap) >= 45) line += ` (${hours(Math.abs(gap))} ${gap > 0 ? "plus tard" : "plus tôt"} que d'habitude)`;
          else line += " (heure habituelle)";
        }
      }
      lines.push(line);
    } else {
      lines.push("- sommeil de la nuit dernière : pas encore reçu");
    }
  }
  if (activityDay?.steps !== null && activityDay?.steps !== undefined) {
    lines.push(`- ${kind === "morning" ? "hier" : "aujourd'hui"} : ${activityDay.steps} pas${activityDay.activeKcal ? `, ${activityDay.activeKcal} kcal actives` : ""}`);
  }
  lines.push(`- sport cette semaine : ${week.done} séance(s) sur ${week.target}${week.doneToday ? ", dont une aujourd'hui" : ""}`);

  if (kind === "evening" && day.weekday === 7) {
    const withSleep = nights.filter((n) => n.sleepMin);
    if (withSleep.length > 0) {
      const average = Math.round(withSleep.reduce((a, n) => a + n.sleepMin!, 0) / withSleep.length);
      lines.push(`- sommeil moyen sur la semaine : ${hours(average)} (${withSleep.length} nuit(s) connue(s))`);
    }
  }
  return lines;
}
