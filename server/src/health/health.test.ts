import { describe, expect, it } from "vitest";
import { parseHealthAutoExport, parseShortcutHealth } from "./ingest.js";
import { sessionFor, shouldScheduleSport } from "./sport.js";

const zone = "Europe/Paris";

describe("parseHealthAutoExport", () => {
  it("additionne les pas par jour, rattache le sommeil au réveil et lit les séances", () => {
    const out = parseHealthAutoExport(
      {
        data: {
          metrics: [
            {
              name: "step_count",
              units: "count",
              data: [
                { date: "2026-11-20 09:00:00 +0100", qty: 3000 },
                { date: "2026-11-20 18:00:00 +0100", qty: 4500.4 },
                { date: "2026-11-19 12:00:00 +0100", qty: 9000 },
              ],
            },
            { name: "active_energy", units: "kJ", data: [{ date: "2026-11-20 00:00:00 +0100", qty: 2092 }] },
            {
              name: "sleep_analysis",
              units: "hr",
              data: [
                {
                  date: "2026-11-20 00:00:00 +0100",
                  totalSleep: 6.5,
                  sleepStart: "2026-11-19 23:40:00 +0100",
                  sleepEnd: "2026-11-20 07:05:00 +0100",
                },
              ],
            },
          ],
          workouts: [
            {
              name: "Traditional Strength Training",
              start: "2026-11-20 18:30:00 +0100",
              end: "2026-11-20 19:35:00 +0100",
              activeEnergyBurned: { qty: 412.6, units: "kcal" },
            },
          ],
        },
      },
      zone,
    );
    const nov20 = out.days.find((d) => d.day === "2026-11-20")!;
    expect(nov20.steps).toBe(7500);
    expect(nov20.activeKcal).toBe(500);
    expect(nov20.sleepMin).toBe(390);
    expect(nov20.sleepStart?.toISOString()).toBe("2026-11-19T22:40:00.000Z");
    expect(out.days.find((d) => d.day === "2026-11-19")?.steps).toBe(9000);
    expect(out.workouts).toEqual([
      {
        type: "Traditional Strength Training",
        startsAt: new Date("2026-11-20T17:30:00Z"),
        endsAt: new Date("2026-11-20T18:35:00Z"),
        kcal: 413,
      },
    ]);
  });
});

describe("parseShortcutHealth", () => {
  it("lit le format du Raccourci du soir", () => {
    const out = parseShortcutHealth(
      {
        jour: "2026-11-20",
        pas: 8123,
        sommeil_minutes: 402,
        seances: [{ type: "Course", debut: "2026-11-20T07:00:00+01:00", fin: "2026-11-20T07:40:00+01:00" }],
      },
      zone,
    );
    expect(out.days).toEqual([{ day: "2026-11-20", steps: 8123, sleepMin: 402 }]);
    expect(out.workouts[0]?.type).toBe("Course");
  });
});

describe("shouldScheduleSport", () => {
  const base = { target: 3, doneThisWeek: 0, doneToday: false, didYesterday: false, daysLeft: 7 };

  it("espace les séances d'un jour de repos", () => {
    expect(shouldScheduleSport(base)).toBe(true);
    expect(shouldScheduleSport({ ...base, doneThisWeek: 1, didYesterday: true, daysLeft: 6 })).toBe(false);
  });

  it("enchaîne quand les jours manquent pour tenir l'objectif", () => {
    expect(shouldScheduleSport({ ...base, doneThisWeek: 1, didYesterday: true, daysLeft: 2 })).toBe(true);
  });

  it("ne place rien quand l'objectif est atteint ou la séance du jour faite", () => {
    expect(shouldScheduleSport({ ...base, doneThisWeek: 3, daysLeft: 3 })).toBe(false);
    expect(shouldScheduleSport({ ...base, doneToday: true, doneThisWeek: 1 })).toBe(false);
  });
});

describe("sessionFor", () => {
  it("allège la séance après une nuit courte", () => {
    expect(sessionFor(330, 60)).toEqual({ title: "Séance légère (nuit courte)", durationMin: 36 });
    expect(sessionFor(450, 60)).toEqual({ title: "Séance de sport", durationMin: 60 });
    expect(sessionFor(null, 60).durationMin).toBe(60);
  });
});
