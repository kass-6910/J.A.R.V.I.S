import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { recordUsage } from "./usage.js";
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { config } from "../config.js";
import { listEvents } from "../connectors/google/calendar.js";
import { db } from "../db/client.js";
import { mealPlans } from "../db/schema.js";
import { claude } from "../lib/claude.js";
import { now, zone } from "../lib/time.js";
import {
  aggregateIngredients,
  dailyKcalTarget,
  fallbackMeal,
  MEAL_LABEL,
  MEAL_SLOTS,
  type Meal,
  type MealSlot,
} from "../meals/rules.js";
import { getHealthDay, sportWeek } from "./health.js";
import { addShoppingItem } from "./shopping.js";

export type MealPlan = typeof mealPlans.$inferSelect;

/** Heures préférées des repas (MEAL_TIMES), collation comprise. */
export function mealTimes(): Record<MealSlot, string> {
  const out: Record<MealSlot, string> = { matin: "08:00", midi: "12:30", collation: "16:30", soir: "19:30" };
  for (const pair of config.MEAL_TIMES.split(",")) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    if (k && (MEAL_SLOTS as readonly string[]).includes(k) && v && /^\d{2}:\d{2}$/.test(v)) out[k as MealSlot] = v;
  }
  return out;
}

export async function getMeals(from: string, to: string): Promise<MealPlan[]> {
  return db
    .select()
    .from(mealPlans)
    .where(and(gte(mealPlans.day, from), lte(mealPlans.day, to)))
    .orderBy(asc(mealPlans.day));
}

const MealSchema = z.object({
  title: z.string().describe("Nom court du plat."),
  description: z.string().describe("Une phrase : ce qu'il y a dans l'assiette, avec les quantités principales."),
  kcal: z.number().int(),
  protein_g: z.number().int(),
  ingredients: z.array(z.object({ name: z.string(), qty: z.string() })).describe("Ingrédients à acheter, sans le sel, le poivre ni l'huile."),
});

const WeekSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      matin: MealSchema,
      midi: MealSchema,
      collation: MealSchema,
      soir: MealSchema,
    }),
  ),
});

const SYSTEM = `Tu prépares les menus de Jessim pour son assistant Jarvis. Objectif : prise de poids, sans y penser.
Chaque jour comporte un petit-déjeuner, un déjeuner, une collation et un dîner. La collation est plus riche les jours de sport (après la séance).
Varie les plats sur la semaine, réutilise les mêmes ingrédients d'un repas à l'autre pour limiter les courses, et prévois des plats rapides les jours chargés.
Les calories et protéines doivent être réalistes pour les quantités indiquées.`;

function toMeal(m: z.infer<typeof MealSchema>): Meal {
  return { title: m.title, description: m.description, kcal: m.kcal, proteinG: m.protein_g, ingredients: m.ingredients };
}

/** Les jours chargés de l'agenda, pour proposer des plats rapides. */
async function busyness(days: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const first = DateTime.fromISO(days[0]!, { zone });
    const last = DateTime.fromISO(days.at(-1)!, { zone }).endOf("day");
    const events = await listEvents(first.toJSDate(), last.toJSDate());
    for (const day of days) {
      const titles = events
        .filter((e) => DateTime.fromJSDate(e.start, { zone }).toISODate() === day && !e.allDay)
        .map((e) => e.title);
      if (titles.length > 0) out.set(day, `${titles.length} rendez-vous (${titles.slice(0, 4).join(", ")})`);
    }
  } catch {
    // Sans agenda, les menus restent possibles.
  }
  return out;
}

async function writeWithClaude(days: string[], note: string | undefined): Promise<Map<string, Record<MealSlot, Meal>> | null> {
  const busy = await busyness(days);
  const lines = days.map((d) => {
    const label = DateTime.fromISO(d, { zone }).setLocale("fr").toFormat("cccc d LLLL");
    return `- ${d} (${label}) : ${busy.get(d) ?? "pas de rendez-vous connu"}`;
  });
  try {
    const res = await claude.messages.parse({
      model: config.JARVIS_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(WeekSchema) },
      messages: [
        {
          role: "user",
          content: `Objectif par jour : environ ${config.MEAL_KCAL_TARGET} kcal et ${config.MEAL_PROTEIN_G} g de protéines.
Préférences : ${config.MEAL_PREFERENCES}.
Sport : ${config.SPORT_SESSIONS_PER_WEEK} séances par semaine, placées au fil des jours.
${note ? `Demande de Jessim : ${note}\n` : ""}Jours à prévoir :
${lines.join("\n")}`,
        },
      ],
    });
    await recordUsage("meals", res);
    const out = res.parsed_output;
    if (res.stop_reason === "refusal" || !out) return null;
    const plan = new Map<string, Record<MealSlot, Meal>>();
    for (const day of out.days.filter((d) => days.includes(d.date))) {
      plan.set(day.date, {
        matin: toMeal(day.matin),
        midi: toMeal(day.midi),
        collation: toMeal(day.collation),
        soir: toMeal(day.soir),
      });
    }
    return plan;
  } catch (err) {
    console.error("Menus : Claude injoignable, menus de secours utilisés.", err);
    return null;
  }
}

/**
 * Prépare les menus des jours donnés (Claude, sinon menus de secours) et ajoute
 * les ingrédients à la liste de courses.
 */
export async function generateMeals(days: string[], note?: string): Promise<MealPlan[]> {
  if (days.length === 0) return [];
  const written = await writeWithClaude(days, note);
  const rows = days.flatMap((day) => {
    const ordinal = DateTime.fromISO(day, { zone }).ordinal;
    return MEAL_SLOTS.map((slot) => {
      const meal = written?.get(day)?.[slot];
      const m = meal ?? fallbackMeal(slot, ordinal);
      return {
        day,
        slot,
        title: m.title,
        description: m.description,
        kcal: m.kcal,
        proteinG: m.proteinG,
        ingredients: m.ingredients,
        source: meal ? ("claude" as const) : ("template" as const),
      };
    });
  });
  // Régénérer remplace les menus des jours concernés.
  const saved = await db.transaction(async (tx) => {
    await tx.delete(mealPlans).where(inArray(mealPlans.day, days));
    return tx.insert(mealPlans).values(rows).returning();
  });
  for (const ing of aggregateIngredients(rows)) {
    await addShoppingItem({ name: ing.name, qty: ing.qty, source: "menu", refType: "meal_plan" });
  }
  return saved;
}

/** Jours à couvrir : jusqu'à dimanche ; le dimanche, la semaine suivante aussi. */
function daysToCover(today: DateTime): string[] {
  const end = today.weekday === 7 ? today.plus({ days: 7 }) : today.endOf("week");
  const out: string[] = [];
  for (let d = today.startOf("day"); d <= end; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

/** Prépare les menus manquants (une fois par heure ; idempotent). */
export async function ensureMealPlan(): Promise<void> {
  const days = daysToCover(now());
  const existing = new Set((await getMeals(days[0]!, days.at(-1)!)).map((m) => m.day));
  const missing = days.filter((d) => !existing.has(d));
  if (missing.length > 0) await generateMeals(missing);
}

/** Refait les menus d'une période, par exemple « pas de poisson cette semaine ». */
export async function regenerateMeals(from: string, to: string, note?: string): Promise<MealPlan[]> {
  const days: string[] = [];
  for (let d = DateTime.fromISO(from, { zone }); d.toISODate()! <= to; d = d.plus({ days: 1 })) days.push(d.toISODate()!);
  return generateMeals(days, note);
}

export function describeMeal(m: MealPlan): string {
  return `${MEAL_LABEL[m.slot]} : ${m.title} (${m.kcal} kcal, ${m.proteinG} g de protéines)`;
}

/** Objectif du jour, ajusté au sport et à la dépense de la veille. */
export async function todayTarget(): Promise<{ kcal: number; sportToday: boolean; activeYesterday: number | null }> {
  const today = now().startOf("day");
  const [week, yesterday] = await Promise.all([sportWeek(today), getHealthDay(today.minus({ days: 1 }))]);
  const blocks = await db.query.scheduleBlocks.findMany({ where: (b, { and, eq }) => and(eq(b.day, today.toISODate()!), eq(b.kind, "sport")) });
  const sportToday = week.doneToday || blocks.length > 0;
  const activeYesterday = yesterday?.activeKcal ?? null;
  return { kcal: dailyKcalTarget(config.MEAL_KCAL_TARGET, sportToday, activeYesterday), sportToday, activeYesterday };
}

export async function mealFacts(): Promise<string[]> {
  const today = now().toISODate()!;
  const meals = await getMeals(today, today);
  if (meals.length === 0) return [];
  const target = await todayTarget();
  const planned = meals.reduce((sum, m) => sum + m.kcal, 0);
  const lines = ["Repas du jour (objectif prise de poids) :", ...meals.map((m) => `- ${describeMeal(m)}`)];
  lines.push(
    `- objectif du jour : ${target.kcal} kcal${target.sportToday ? " (jour de sport)" : ""} ; les menus en prévoient ${planned}${planned < target.kcal - 150 ? ` : ajouter environ ${target.kcal - planned} kcal (une collation de plus, ou des portions plus grosses)` : ""}`,
  );
  return lines;
}
