import { and, gte, lt, sql } from "drizzle-orm";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { claudeUsage } from "../db/schema.js";
import { now } from "../lib/time.js";
import { costMicroUsd, crossedThresholds, projectMonth, type TokenUsage } from "../usage/pricing.js";
import { getValue, setValue } from "./kv.js";

/** Fonctions de Jarvis qui appellent Claude, avec leur nom affiché. */
export const USAGE_FEATURES = {
  conversation: "Conversations",
  briefing: "Briefing et bilan",
  mail_triage: "Tri des mails",
  task_spaces: "Classement des tâches",
  receipt: "Factures en photo",
  garment: "Vêtements en photo",
  course: "Cours en PDF",
  meals: "Menus de la semaine",
} as const;
export type UsageFeature = keyof typeof USAGE_FEATURES;

/**
 * Enregistre la consommation d'une réponse de Claude. Ne bloque jamais la fonction appelante :
 * une erreur d'enregistrement est seulement journalisée.
 */
export async function recordUsage(feature: UsageFeature, res: { model: string; usage: TokenUsage }): Promise<void> {
  try {
    await db.insert(claudeUsage).values({
      feature,
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      costMicroUsd: costMicroUsd(res.model, res.usage),
    });
    await alertIfOverBudget();
  } catch (err) {
    console.error("Consommation de Claude non enregistrée :", err);
  }
}

async function spentSince(from: Date, to?: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${claudeUsage.costMicroUsd}), 0)` })
    .from(claudeUsage)
    .where(to ? and(gte(claudeUsage.at, from), lt(claudeUsage.at, to)) : gte(claudeUsage.at, from));
  return Number(row?.total ?? 0);
}

/** Une notification par seuil (80 %, 100 %) et par mois. */
async function alertIfOverBudget(): Promise<void> {
  const budget = config.CLAUDE_MONTHLY_BUDGET_USD;
  if (budget <= 0 || !isNotifyConfigured()) return;
  const month = now().startOf("month");
  const spent = await spentSince(month.toJSDate());
  const [threshold] = crossedThresholds(spent, budget);
  if (threshold === undefined) return;
  const key = `claude-usage-alert:${month.toFormat("yyyy-MM")}:${threshold}`;
  if (await getValue(key)) return;
  await setValue(key, new Date().toISOString());
  await sendNotification({
    title: threshold >= 100 ? "Crédits Claude : plafond atteint" : "Crédits Claude : 80 % du plafond",
    message: `${formatUsd(spent)} dépensés ce mois-ci, pour un plafond de ${budget} $.`,
    priority: threshold >= 100 ? 4 : 3,
    tags: ["money_with_wings"],
  });
}

function formatUsd(micro: number): string {
  return `${(micro / 1_000_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

export interface UsageSummary {
  /** Montants en dollars. */
  today: number;
  month: number;
  lastMonth: number;
  projection: number;
  budget: number;
  requestsToday: number;
  byFeature: { feature: string; label: string; usd: number; requests: number }[];
  days: { day: string; usd: number }[];
}

const usd = (micro: number) => Math.round(micro / 10) / 100_000;

export async function usageSummary(): Promise<UsageSummary> {
  const t = now();
  const today = t.startOf("day");
  const month = t.startOf("month");
  const lastMonth = month.minus({ months: 1 });
  const since30 = today.minus({ days: 29 });

  const [spentToday, spentMonth, spentLastMonth, [countToday], features, days] = await Promise.all([
    spentSince(today.toJSDate()),
    spentSince(month.toJSDate()),
    spentSince(lastMonth.toJSDate(), month.toJSDate()),
    db
      .select({ n: sql<string>`count(*)` })
      .from(claudeUsage)
      .where(gte(claudeUsage.at, today.toJSDate())),
    db
      .select({
        feature: claudeUsage.feature,
        total: sql<string>`sum(${claudeUsage.costMicroUsd})`,
        n: sql<string>`count(*)`,
      })
      .from(claudeUsage)
      .where(gte(claudeUsage.at, month.toJSDate()))
      .groupBy(claudeUsage.feature),
    db
      .select({
        day: sql<string>`to_char(${claudeUsage.at} at time zone ${config.TIMEZONE}, 'YYYY-MM-DD')`,
        total: sql<string>`sum(${claudeUsage.costMicroUsd})`,
      })
      .from(claudeUsage)
      .where(gte(claudeUsage.at, since30.toJSDate()))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  return {
    today: usd(spentToday),
    month: usd(spentMonth),
    lastMonth: usd(spentLastMonth),
    projection: usd(projectMonth(spentMonth, t.day, t.daysInMonth ?? 30)),
    budget: config.CLAUDE_MONTHLY_BUDGET_USD,
    requestsToday: Number(countToday?.n ?? 0),
    byFeature: features
      .map((f) => ({
        feature: f.feature,
        label: USAGE_FEATURES[f.feature as UsageFeature] ?? f.feature,
        usd: usd(Number(f.total)),
        requests: Number(f.n),
      }))
      .sort((a, b) => b.usd - a.usd),
    days: days.map((d) => ({ day: d.day, usd: usd(Number(d.total)) })),
  };
}
