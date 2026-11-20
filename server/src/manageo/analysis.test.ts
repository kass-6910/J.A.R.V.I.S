import { describe, expect, it } from "vitest";
import type { ManageoConsumption, ManageoPlanning, ManageoStockItem } from "../connectors/manageo/types.js";
import { analyzeStock, coverageGaps, groupBySupplier, isLow, orderQuantity, stockThreshold } from "./analysis.js";

function item(id: number, over: Partial<ManageoStockItem> = {}): ManageoStockItem {
  return {
    id,
    name: `Article ${id}`,
    category: null,
    unit: "L",
    qty: 10,
    min_qty: 0,
    stock_alerte: null,
    stock_securite: null,
    stock_maximum: null,
    supplier: { id: 1, name: "Laiterie Dumont" },
    ...over,
  };
}

/** n jours de ventes identiques avant « today ». */
function sales(itemId: number, perDay: number, days: number, today = "2026-11-20"): ManageoConsumption[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (i + 1));
    return { stock_item_id: itemId, day: d.toISOString().slice(0, 10), qty: perDay };
  });
}

describe("seuils de stock", () => {
  it("préfère stock_alerte à min_qty, comme le backend de Manageo", () => {
    expect(stockThreshold(item(1, { min_qty: 4, stock_alerte: 6 }))).toBe(6);
    expect(stockThreshold(item(1, { min_qty: 4, stock_alerte: 0 }))).toBe(4);
  });

  it("signale un stock épuisé même sans seuil", () => {
    expect(isLow(item(1, { qty: 0 }))).toBe(true);
    expect(isLow(item(1, { qty: 3 }))).toBe(false);
    expect(isLow(item(1, { qty: 4, min_qty: 4 }))).toBe(true);
  });
});

describe("orderQuantity", () => {
  it("remonte au stock maximum, sinon à deux fois le seuil, sinon à une semaine de ventes", () => {
    expect(orderQuantity(item(1, { qty: 3, stock_maximum: 20 }), 2)).toBe(17);
    expect(orderQuantity(item(1, { qty: 3, min_qty: 5 }), 2)).toBe(7);
    expect(orderQuantity(item(1, { qty: 3 }), 2.5)).toBe(15);
    expect(orderQuantity(item(1, { qty: -2, min_qty: 5 }), 0)).toBe(10);
  });
});

describe("analyzeStock", () => {
  it("sépare le stock bas des ruptures prévues, les plus urgentes d'abord", () => {
    const items = [
      item(1, { name: "Lait", qty: 6, min_qty: 2 }), // 3 par jour → 2 jours
      item(2, { name: "Café", qty: 1, min_qty: 2 }), // sous le seuil
      item(3, { name: "Sucre", qty: 50, min_qty: 2 }), // 1 par jour → 50 jours
      item(4, { name: "Thé", qty: 5, min_qty: 2 }), // ne se vend pas
    ];
    const consumption = [...sales(1, 3, 14), ...sales(2, 1, 14), ...sales(3, 1, 14)];
    const out = analyzeStock(items, consumption, "2026-11-20", 3);
    expect(out.low.map((l) => l.item.name)).toEqual(["Café"]);
    expect(out.ruptures.map((l) => [l.item.name, l.daysLeft, l.ruptureDate])).toEqual([["Lait", 2, "2026-11-22"]]);
  });

  it("ne compte que les quatorze derniers jours", () => {
    const consumption = sales(1, 10, 30).filter((c) => c.day < "2026-11-01");
    const out = analyzeStock([item(1, { qty: 5 })], consumption, "2026-11-20", 3);
    expect(out.ruptures).toEqual([]);
  });

  it("regroupe le bon de commande par fournisseur", () => {
    const out = analyzeStock(
      [
        item(1, { qty: 0, min_qty: 2 }),
        item(2, { qty: 0, min_qty: 2, supplier: { id: 2, name: "Brûlerie" } }),
        item(3, { qty: 0, min_qty: 2, supplier: null }),
      ],
      [],
      "2026-11-20",
      3,
    );
    expect([...groupBySupplier(out.low).keys()]).toEqual(["Laiterie Dumont", "Brûlerie", "Fournisseur non renseigné"]);
  });
});

describe("coverageGaps", () => {
  const planning: ManageoPlanning = {
    week_start: "2026-11-16",
    published: true,
    ouverture: [{ date: "2026-11-20", start: "08:00", end: "20:00" }],
    shifts: [
      { user_id: 1, name: "Amel", date: "2026-11-20", start: "08:00", end: "14:00", lieu: null },
      { user_id: 2, name: "Bilal", date: "2026-11-20", start: "14:00", end: "20:00", lieu: null },
      { user_id: 3, name: "Chloé", date: "2026-11-18", start: "08:00", end: "18:00", lieu: null },
    ],
    absences: [{ user_id: 2, name: "Bilal", date: "2026-11-20", type: "maladie" }],
    disponibilites: [
      { user_id: 3, name: "Chloé", date: "2026-11-20", start: "12:00", end: "21:00" },
      { user_id: 4, name: "David", date: "2026-11-20", start: "13:00", end: "20:00" },
      { user_id: 5, name: "Emma", date: "2026-11-20", start: "16:00", end: "20:00" },
      { user_id: 2, name: "Bilal", date: "2026-11-20", start: "08:00", end: "20:00" },
    ],
    employes: [],
  };

  it("trouve le créneau laissé vide par une absence et propose les disponibles les moins chargés", () => {
    expect(coverageGaps(planning, "2026-11-20")).toEqual([
      { date: "2026-11-20", start: "14:00", end: "20:00", absent: ["Bilal"], suggestions: ["David", "Chloé"] },
    ]);
  });

  it("ne signale rien quand la journée est couverte", () => {
    const covered = { ...planning, absences: [] };
    expect(coverageGaps(covered, "2026-11-20")).toEqual([]);
  });

  it("gère un service qui finit à minuit", () => {
    const late: ManageoPlanning = {
      ...planning,
      absences: [],
      ouverture: [{ date: "2026-11-20", start: "18:00", end: "24:00" }],
      shifts: [{ user_id: 1, name: "Amel", date: "2026-11-20", start: "18:00", end: "24:00", lieu: null }],
    };
    expect(coverageGaps(late, "2026-11-20")).toEqual([]);
  });
});
