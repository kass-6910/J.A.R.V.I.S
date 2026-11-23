import { describe, expect, it } from "vitest";
import { dueRoutines, isIntervalDue, toMinutes } from "./routines.js";

const base = { morningAt: "07:00", eveningAt: "21:30", morningDone: false, eveningDone: false };

describe("dueRoutines", () => {
  it("ne lance rien avant l'heure", () => {
    expect(dueRoutines({ ...base, minutes: toMinutes("06:59") })).toEqual([]);
  });

  it("lance le briefing à l'heure, ou en rattrapage jusqu'à midi", () => {
    expect(dueRoutines({ ...base, minutes: toMinutes("07:00") })).toEqual(["morning"]);
    expect(dueRoutines({ ...base, minutes: toMinutes("11:59") })).toEqual(["morning"]);
    expect(dueRoutines({ ...base, minutes: toMinutes("12:00") })).toEqual([]);
  });

  it("ne relance pas une routine déjà faite", () => {
    expect(dueRoutines({ ...base, minutes: toMinutes("08:00"), morningDone: true })).toEqual([]);
    expect(dueRoutines({ ...base, minutes: toMinutes("22:00"), eveningDone: true })).toEqual([]);
  });

  it("lance le bilan du soir jusqu'à minuit", () => {
    expect(dueRoutines({ ...base, minutes: toMinutes("23:59") })).toEqual(["evening"]);
  });

  it("laisse une heure de rattrapage à un briefing réglé tard", () => {
    expect(dueRoutines({ ...base, morningAt: "11:30", minutes: toMinutes("12:15") })).toEqual(["morning"]);
  });
});

describe("isIntervalDue", () => {
  it("tourne au démarrage puis à chaque intervalle", () => {
    expect(isIntervalDue(null, 1000, 900)).toBe(true);
    expect(isIntervalDue(1000, 1899, 900)).toBe(false);
    expect(isIntervalDue(1000, 1900, 900)).toBe(true);
  });
});
