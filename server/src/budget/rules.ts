/** Budget : montants en centimes, dates AAAA-MM-JJ. Fonctions pures, testées à part. */

export const EXPENSE_CATEGORIES = [
  "alimentation",
  "restaurants",
  "transport",
  "logement",
  "abonnements",
  "sante",
  "vetements",
  "loisirs",
  "etudes",
  "cadeaux",
  "professionnel",
  "autre",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  alimentation: "Alimentation",
  restaurants: "Restaurants",
  transport: "Transport",
  logement: "Logement",
  abonnements: "Abonnements",
  sante: "Santé",
  vetements: "Vêtements",
  loisirs: "Loisirs",
  etudes: "Études",
  cadeaux: "Cadeaux",
  professionnel: "Professionnel",
  autre: "Autre",
};

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Jour de prélèvement d'un abonnement dans un mois donné (le 31 tombe le 30 ou le 28 si besoin). */
export function subscriptionDate(dayOfMonth: number, month: string): string {
  const day = Math.min(dayOfMonth, daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

export interface BudgetStatus {
  spent: number;
  limit: number;
  /** Projection de fin de mois au rythme actuel (abonnements à venir compris). */
  projected: number;
  /** 0 : rien à signaler ; 80 : 80 % atteints ; 100 : dépassé. */
  level: 0 | 80 | 100;
}

/**
 * État du budget au jour « day » du mois : dépenses variables extrapolées au mois entier,
 * abonnements comptés une seule fois.
 */
export function budgetStatus(input: {
  variableSpent: number;
  subscriptionsSpent: number;
  subscriptionsUpcoming: number;
  limit: number;
  day: number;
  monthDays: number;
}): BudgetStatus {
  const spent = input.variableSpent + input.subscriptionsSpent;
  const projected = Math.round((input.variableSpent / input.day) * input.monthDays) + input.subscriptionsSpent + input.subscriptionsUpcoming;
  const level = input.limit <= 0 ? 0 : spent >= input.limit ? 100 : spent >= input.limit * 0.8 ? 80 : 0;
  return { spent, limit: input.limit, projected, level };
}

/** « 1234567 » centimes → « 12 345,67 € ». */
export function formatEuros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

/** « 12,50 », « 12.5 », « 12 » → centimes. */
export function parseEuros(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value.replace(/\s|€/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Montant illisible : ${value}`);
  return Math.round(n * 100);
}
