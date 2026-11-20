import { DateTime } from "luxon";

/** Données Santé normalisées, quel que soit l'export d'origine. Fonctions pures, testées à part. */

export interface DayHealth {
  day: string;
  steps?: number;
  activeKcal?: number;
  sleepMin?: number;
  sleepStart?: Date;
  sleepEnd?: Date;
}

export interface WorkoutInput {
  type: string;
  startsAt: Date;
  endsAt: Date;
  kcal?: number;
}

export interface HealthImport {
  days: DayHealth[];
  workouts: WorkoutInput[];
}

/** « 2026-11-20 07:12:00 +0100 » (Health Auto Export) ou ISO 8601. */
export function parseHealthDate(value: string, zone: string): DateTime {
  const hae = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm:ss ZZZ", { setZone: true });
  const dt = hae.isValid ? hae : DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) throw new Error(`Date illisible : ${value}`);
  return dt.setZone(zone);
}

function mergeDay(days: Map<string, DayHealth>, day: string, patch: Partial<DayHealth>): void {
  const current = days.get(day) ?? { day };
  days.set(day, { ...current, ...patch });
}

interface HaeMetric {
  name: string;
  units?: string;
  data: Record<string, unknown>[];
}

interface HaeWorkout {
  name: string;
  start: string;
  end: string;
  activeEnergyBurned?: { qty: number; units?: string };
  activeEnergy?: { qty: number; units?: string } | { qty: number }[];
}

/**
 * Format de l'app « Health Auto Export » (JSON, version 2) :
 * { data: { metrics: [{ name, units, data: [{ date, qty }] }], workouts: [...] } }.
 */
export function parseHealthAutoExport(body: unknown, zone: string): HealthImport {
  const data = (body as { data?: { metrics?: HaeMetric[]; workouts?: HaeWorkout[] } }).data ?? {};
  const days = new Map<string, DayHealth>();
  const sums = new Map<string, { steps: number; kcal: number; hasSteps: boolean; hasKcal: boolean }>();

  for (const metric of data.metrics ?? []) {
    for (const entry of metric.data ?? []) {
      const date = parseHealthDate(String(entry.date), zone);
      const day = date.toISODate()!;
      if (metric.name === "step_count" || metric.name === "active_energy") {
        // Les données peuvent être agrégées par heure : on additionne par jour.
        const sum = sums.get(day) ?? { steps: 0, kcal: 0, hasSteps: false, hasKcal: false };
        let qty = Number(entry.qty ?? 0);
        if (metric.name === "active_energy" && metric.units === "kJ") qty = qty / 4.184;
        if (metric.name === "step_count") Object.assign(sum, { steps: sum.steps + qty, hasSteps: true });
        else Object.assign(sum, { kcal: sum.kcal + qty, hasKcal: true });
        sums.set(day, sum);
      } else if (metric.name === "sleep_analysis") {
        const hours = Number(entry.totalSleep ?? entry.asleep ?? 0);
        const end = entry.sleepEnd ? parseHealthDate(String(entry.sleepEnd), zone) : date;
        mergeDay(days, end.toISODate()!, {
          sleepMin: Math.round(hours * 60),
          ...(entry.sleepStart ? { sleepStart: parseHealthDate(String(entry.sleepStart), zone).toJSDate() } : {}),
          ...(entry.sleepEnd ? { sleepEnd: end.toJSDate() } : {}),
        });
      }
    }
  }
  for (const [day, sum] of sums) {
    mergeDay(days, day, {
      ...(sum.hasSteps && { steps: Math.round(sum.steps) }),
      ...(sum.hasKcal && { activeKcal: Math.round(sum.kcal) }),
    });
  }

  const workouts = (data.workouts ?? []).map((w) => {
    const energy = Array.isArray(w.activeEnergy)
      ? w.activeEnergy.reduce((total, e) => total + e.qty, 0)
      : (w.activeEnergyBurned?.qty ?? w.activeEnergy?.qty);
    return {
      type: w.name,
      startsAt: parseHealthDate(w.start, zone).toJSDate(),
      endsAt: parseHealthDate(w.end, zone).toJSDate(),
      ...(energy !== undefined && { kcal: Math.round(energy) }),
    };
  });
  return { days: [...days.values()], workouts };
}

/**
 * Format simple envoyé par le Raccourci « Santé » du soir :
 * { jour, pas, calories_actives, sommeil_minutes, coucher, reveil, seances: [{ type, debut, fin, calories }] }.
 */
export function parseShortcutHealth(body: unknown, zone: string): HealthImport {
  const b = body as {
    jour: string;
    pas?: number;
    calories_actives?: number;
    sommeil_minutes?: number;
    coucher?: string;
    reveil?: string;
    seances?: { type: string; debut: string; fin: string; calories?: number }[];
  };
  const day = parseHealthDate(b.jour, zone).toISODate()!;
  return {
    days: [
      {
        day,
        ...(b.pas !== undefined && { steps: Math.round(b.pas) }),
        ...(b.calories_actives !== undefined && { activeKcal: Math.round(b.calories_actives) }),
        ...(b.sommeil_minutes !== undefined && { sleepMin: Math.round(b.sommeil_minutes) }),
        ...(b.coucher && { sleepStart: parseHealthDate(b.coucher, zone).toJSDate() }),
        ...(b.reveil && { sleepEnd: parseHealthDate(b.reveil, zone).toJSDate() }),
      },
    ],
    workouts: (b.seances ?? []).map((s) => ({
      type: s.type,
      startsAt: parseHealthDate(s.debut, zone).toJSDate(),
      endsAt: parseHealthDate(s.fin, zone).toJSDate(),
      ...(s.calories !== undefined && { kcal: Math.round(s.calories) }),
    })),
  };
}
