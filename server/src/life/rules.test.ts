import { describe, expect, it } from "vitest";
import { ageAt, contactOverdueDays, isCareDue, nextBirthday, nextCareDate, supplementTime } from "./rules.js";

describe("soins récurrents", () => {
  it("calcule la prochaine échéance et la prévoit une semaine à l'avance", () => {
    expect(nextCareDate("2026-10-20", 35, "2026-11-20")).toBe("2026-11-24");
    expect(isCareDue("2026-10-20", 35, "2026-11-20")).toBe(true);
    expect(isCareDue("2026-11-10", 35, "2026-11-20")).toBe(false);
    expect(isCareDue(null, 90, "2026-11-20")).toBe(true);
  });
});

describe("anniversaires", () => {
  it("trouve le prochain anniversaire, cette année ou la suivante", () => {
    expect(nextBirthday("12-03", "2026-11-20")).toBe("2026-12-03");
    expect(nextBirthday("11-20", "2026-11-20")).toBe("2026-11-20");
    expect(nextBirthday("01-15", "2026-11-20")).toBe("2027-01-15");
  });

  it("place un 29 février le 28 hors année bissextile", () => {
    expect(nextBirthday("02-29", "2026-11-20")).toBe("2027-02-28");
    expect(nextBirthday("02-29", "2027-11-20")).toBe("2028-02-29");
  });

  it("donne l'âge si l'année est connue", () => {
    expect(ageAt(1960, "2026-12-03")).toBe(66);
    expect(ageAt(null, "2026-12-03")).toBeNull();
  });
});

describe("proches", () => {
  it("signale un proche pas appelé depuis trop longtemps", () => {
    expect(contactOverdueDays("2026-11-01", 14, "2026-11-20", "2026-01-01")).toBe(5);
    expect(contactOverdueDays("2026-11-10", 14, "2026-11-20", "2026-01-01")).toBeNull();
    expect(contactOverdueDays(null, 30, "2026-11-20", "2026-10-01")).toBe(20);
    expect(contactOverdueDays(null, null, "2026-11-20", "2026-01-01")).toBeNull();
  });
});

describe("supplementTime", () => {
  const defaults = { matin: 8 * 3600e3, midi: 12.5 * 3600e3, soir: 19.5 * 3600e3 };

  it("se cale sur le repas s'il est placé, sinon sur l'heure par défaut", () => {
    expect(supplementTime("midi", { meals: { midi: 13 * 3600e3 }, sport: null }, defaults)).toBe(13 * 3600e3);
    expect(supplementTime("soir", { meals: {}, sport: null }, defaults)).toBe(19.5 * 3600e3);
  });

  it("se cale sur la séance de sport, et rien un jour sans séance", () => {
    const sport = { start: 18 * 3600e3, end: 19 * 3600e3 };
    expect(supplementTime("avant_sport", { meals: {}, sport }, defaults)).toBe(17.5 * 3600e3);
    expect(supplementTime("apres_sport", { meals: {}, sport }, defaults)).toBe(19 * 3600e3);
    expect(supplementTime("apres_sport", { meals: {}, sport: null }, defaults)).toBeNull();
  });
});
