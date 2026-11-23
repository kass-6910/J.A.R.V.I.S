/** Repas : créneaux, objectif du jour et menus de secours. Fonctions pures, testées à part. */

export const MEAL_SLOTS = ["matin", "midi", "collation", "soir"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_LABEL: Record<MealSlot, string> = {
  matin: "Petit-déjeuner",
  midi: "Déjeuner",
  collation: "Collation",
  soir: "Dîner",
};

export const MEAL_DURATION_MIN: Record<MealSlot, number> = { matin: 20, midi: 40, collation: 15, soir: 40 };

/**
 * Objectif calorique du jour : la base, plus un supplément les jours de sport,
 * plus une partie de l'énergie active de la veille au-delà d'une journée normale (400 kcal).
 */
export function dailyKcalTarget(base: number, sportToday: boolean, activeKcalYesterday: number | null): number {
  const sport = sportToday ? 350 : 0;
  const extra = activeKcalYesterday && activeKcalYesterday > 400 ? Math.round((activeKcalYesterday - 400) * 0.5) : 0;
  return base + sport + Math.min(extra, 600);
}

export interface Ingredient {
  name: string;
  qty: string;
}

export interface Meal {
  title: string;
  description: string;
  kcal: number;
  proteinG: number;
  ingredients: Ingredient[];
}

/** Menus simples, riches et rapides, pour quand Claude ne répond pas. Tournent sur 7 jours. */
const FALLBACK: Record<MealSlot, Meal[]> = {
  matin: [
    { title: "Flocons d'avoine, banane et beurre de cacahuète", description: "100 g d'avoine au lait entier, une banane, deux cuillères de beurre de cacahuète.", kcal: 850, proteinG: 30, ingredients: [{ name: "Flocons d'avoine", qty: "100 g" }, { name: "Lait entier", qty: "40 cl" }, { name: "Bananes", qty: "1" }, { name: "Beurre de cacahuète", qty: "30 g" }] },
    { title: "Omelette trois œufs, pain complet et avocat", description: "Trois œufs, deux tranches de pain complet, un demi-avocat, un verre de jus d'orange.", kcal: 780, proteinG: 32, ingredients: [{ name: "Œufs", qty: "3" }, { name: "Pain complet", qty: "2 tranches" }, { name: "Avocats", qty: "1/2" }, { name: "Jus d'orange", qty: "25 cl" }] },
    { title: "Fromage blanc, granola et fruits secs", description: "300 g de fromage blanc entier, granola, amandes et raisins secs, un fruit.", kcal: 800, proteinG: 35, ingredients: [{ name: "Fromage blanc entier", qty: "300 g" }, { name: "Granola", qty: "80 g" }, { name: "Amandes", qty: "30 g" }, { name: "Raisins secs", qty: "30 g" }] },
  ],
  midi: [
    { title: "Poulet, riz basmati et légumes sautés", description: "200 g de poulet, 120 g de riz cru, légumes sautés à l'huile d'olive.", kcal: 950, proteinG: 55, ingredients: [{ name: "Blancs de poulet", qty: "200 g" }, { name: "Riz basmati", qty: "120 g" }, { name: "Poêlée de légumes", qty: "200 g" }] },
    { title: "Pâtes à la bolognaise de bœuf", description: "130 g de pâtes, 180 g de bœuf haché, sauce tomate, parmesan.", kcal: 1050, proteinG: 55, ingredients: [{ name: "Pâtes", qty: "130 g" }, { name: "Bœuf haché", qty: "180 g" }, { name: "Sauce tomate", qty: "200 g" }, { name: "Parmesan", qty: "30 g" }] },
    { title: "Saumon, patates douces et haricots verts", description: "180 g de saumon, 300 g de patate douce rôtie, haricots verts.", kcal: 900, proteinG: 45, ingredients: [{ name: "Pavés de saumon", qty: "180 g" }, { name: "Patates douces", qty: "300 g" }, { name: "Haricots verts", qty: "150 g" }] },
    { title: "Wrap poulet, crudités et houmous", description: "Deux grandes tortillas, poulet grillé, houmous, crudités, un fruit.", kcal: 900, proteinG: 50, ingredients: [{ name: "Tortillas", qty: "2" }, { name: "Blancs de poulet", qty: "180 g" }, { name: "Houmous", qty: "60 g" }, { name: "Crudités", qty: "1 barquette" }] },
  ],
  collation: [
    { title: "Shaker lait, banane et avoine", description: "Lait entier, une banane, 40 g d'avoine, une cuillère de miel.", kcal: 550, proteinG: 22, ingredients: [{ name: "Lait entier", qty: "40 cl" }, { name: "Bananes", qty: "1" }, { name: "Flocons d'avoine", qty: "40 g" }, { name: "Miel", qty: "1 c. à s." }] },
    { title: "Skyr, noix et fruit", description: "Un pot de skyr, une poignée de noix, un fruit.", kcal: 450, proteinG: 25, ingredients: [{ name: "Skyr", qty: "1 pot" }, { name: "Noix", qty: "30 g" }] },
  ],
  soir: [
    { title: "Bœuf, pommes de terre et salade", description: "200 g de steak, 350 g de pommes de terre sautées, salade verte.", kcal: 950, proteinG: 50, ingredients: [{ name: "Steaks de bœuf", qty: "200 g" }, { name: "Pommes de terre", qty: "350 g" }, { name: "Salade", qty: "1" }] },
    { title: "Curry de poulet au lait de coco et riz", description: "Poulet, lait de coco, pois chiches, 120 g de riz.", kcal: 1000, proteinG: 50, ingredients: [{ name: "Blancs de poulet", qty: "180 g" }, { name: "Lait de coco", qty: "20 cl" }, { name: "Pois chiches", qty: "1 boîte" }, { name: "Riz basmati", qty: "120 g" }] },
    { title: "Omelette garnie, pain et fromage", description: "Quatre œufs, champignons et fromage, pain complet.", kcal: 850, proteinG: 45, ingredients: [{ name: "Œufs", qty: "4" }, { name: "Champignons", qty: "150 g" }, { name: "Emmental râpé", qty: "40 g" }, { name: "Pain complet", qty: "2 tranches" }] },
  ],
};

/** Menu de secours d'un créneau pour un jour donné (index du jour dans l'année). */
export function fallbackMeal(slot: MealSlot, dayIndex: number): Meal {
  const list = FALLBACK[slot];
  return list[dayIndex % list.length]!;
}

/** Courses d'un ensemble de repas : un ingrédient par nom, quantités listées. */
export function aggregateIngredients(meals: Meal[]): Ingredient[] {
  const byName = new Map<string, { name: string; qtys: string[] }>();
  for (const ing of meals.flatMap((m) => m.ingredients)) {
    const key = ing.name.trim().toLowerCase();
    const entry = byName.get(key) ?? { name: ing.name.trim(), qtys: [] };
    entry.qtys.push(ing.qty);
    byName.set(key, entry);
  }
  return [...byName.values()].map((e) => ({ name: e.name, qty: sumQuantities(e.qtys) }));
}

/** « 100 g » + « 150 g » → « 250 g » ; unités différentes ou quantités libres → listées. */
export function sumQuantities(qtys: string[]): string {
  if (qtys.length === 1) return qtys[0]!;
  const parsed = qtys.map((q) => q.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/));
  const units = new Set(parsed.map((m) => m?.[2]?.toLowerCase() ?? null));
  if (parsed.every((m) => m !== null) && units.size === 1) {
    const total = parsed.reduce((sum, m) => sum + Number(m![1]!.replace(",", ".")), 0);
    const unit = parsed[0]![2]!;
    return `${String(Math.round(total * 100) / 100).replace(".", ",")}${unit ? ` ${unit}` : ""}`;
  }
  return qtys.join(" + ");
}
