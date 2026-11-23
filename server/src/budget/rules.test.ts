import { describe, expect, it } from "vitest";
import { budgetStatus, daysInMonth, formatEuros, parseEuros, subscriptionDate } from "./rules.js";

describe("dates d'abonnement", () => {
  it("ramène un jour trop grand au dernier jour du mois", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(subscriptionDate(31, "2026-11")).toBe("2026-11-30");
    expect(subscriptionDate(5, "2026-11")).toBe("2026-11-05");
  });
});

describe("budgetStatus", () => {
  const base = { subscriptionsSpent: 3000, subscriptionsUpcoming: 1000, limit: 100000, day: 10, monthDays: 30 };

  it("extrapole les dépenses variables sans multiplier les abonnements", () => {
    const s = budgetStatus({ ...base, variableSpent: 20000 });
    expect(s).toEqual({ spent: 23000, limit: 100000, projected: 64000, level: 0 });
  });

  it("alerte à 80 % puis au dépassement", () => {
    expect(budgetStatus({ ...base, variableSpent: 78000 }).level).toBe(80);
    expect(budgetStatus({ ...base, variableSpent: 97000 }).level).toBe(100);
    expect(budgetStatus({ ...base, variableSpent: 97000, limit: 0 }).level).toBe(0);
  });
});

describe("montants", () => {
  it("lit et écrit les montants en euros", () => {
    expect(parseEuros("12,50 €")).toBe(1250);
    expect(parseEuros(9.99)).toBe(999);
    expect(() => parseEuros("douze")).toThrow();
    expect(formatEuros(1250)).toBe("12,50 €");
    expect(formatEuros(123400)).toMatch(/^1\s234 €$/);
  });
});
