import { describe, expect, it } from "vitest";
import { aggregateIngredients, dailyKcalTarget, fallbackMeal, MEAL_SLOTS, sumQuantities } from "./rules.js";

describe("dailyKcalTarget", () => {
  it("ajoute un supplément les jours de sport et après une grosse dépense", () => {
    expect(dailyKcalTarget(3000, false, null)).toBe(3000);
    expect(dailyKcalTarget(3000, true, 300)).toBe(3350);
    expect(dailyKcalTarget(3000, false, 1000)).toBe(3300);
    expect(dailyKcalTarget(3000, false, 5000)).toBe(3600);
  });
});

describe("fallbackMeal", () => {
  it("propose un repas complet pour chaque créneau et varie d'un jour à l'autre", () => {
    for (const slot of MEAL_SLOTS) {
      const meal = fallbackMeal(slot, 0);
      expect(meal.ingredients.length).toBeGreaterThan(0);
      expect(meal.kcal).toBeGreaterThan(0);
    }
    expect(fallbackMeal("midi", 0).title).not.toBe(fallbackMeal("midi", 1).title);
  });
});

describe("aggregateIngredients", () => {
  it("regroupe un même ingrédient, sans tenir compte des majuscules", () => {
    const out = aggregateIngredients([
      { title: "a", description: "", kcal: 0, proteinG: 0, ingredients: [{ name: "Riz basmati", qty: "120 g" }, { name: "Œufs", qty: "3" }] },
      { title: "b", description: "", kcal: 0, proteinG: 0, ingredients: [{ name: "riz basmati ", qty: "100 g" }] },
    ]);
    expect(out).toEqual([
      { name: "Riz basmati", qty: "220 g" },
      { name: "Œufs", qty: "3" },
    ]);
  });
});

describe("sumQuantities", () => {
  it("additionne les mêmes unités et liste le reste", () => {
    expect(sumQuantities(["1", "1", "1"])).toBe("3");
    expect(sumQuantities(["40 cl", "0,5 cl"])).toBe("40,5 cl");
    expect(sumQuantities(["200 g", "1 boîte"])).toBe("200 g + 1 boîte");
    expect(sumQuantities(["1/2", "1"])).toBe("1/2 + 1");
  });
});
