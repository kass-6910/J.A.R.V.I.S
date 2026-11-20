import type { ManageoConsumption, ManageoPlanning, ManageoStockItem } from "../connectors/manageo/types.js";

/** Analyse des données Manageo : fonctions pures, sans réseau ni horloge, testées à part. */

/**
 * Seuil d'alerte d'un article, comme le backend de Manageo : stock_alerte s'il est renseigné,
 * sinon min_qty.
 */
export function stockThreshold(item: ManageoStockItem): number {
  return item.stock_alerte && item.stock_alerte > 0 ? item.stock_alerte : (item.min_qty ?? 0);
}

/** Stock bas : sous le seuil, ou épuisé même sans seuil (comme l'écran inventaire de Manageo). */
export function isLow(item: ManageoStockItem): boolean {
  const threshold = stockThreshold(item);
  return item.qty <= 0 || (threshold > 0 && item.qty <= threshold);
}

/** Consommation moyenne par jour sur les « days » derniers jours (les jours sans vente comptent pour zéro). */
export function dailyConsumption(
  itemId: number,
  consumption: ManageoConsumption[],
  today: string,
  days = 14,
): number {
  const from = addDays(today, -days);
  const total = consumption
    .filter((c) => c.stock_item_id === itemId && c.day >= from && c.day < today)
    .reduce((sum, c) => sum + c.qty, 0);
  return total / days;
}

/**
 * Quantité à commander pour revenir au stock cible : stock_maximum s'il est renseigné,
 * sinon deux fois le seuil (règle de l'inventaire de Manageo), sinon une semaine de ventes.
 */
export function orderQuantity(item: ManageoStockItem, perDay: number): number {
  const threshold = stockThreshold(item);
  const target =
    item.stock_maximum && item.stock_maximum > 0
      ? item.stock_maximum
      : threshold > 0
        ? 2 * threshold
        : Math.ceil(perDay * 7);
  return Math.max(0, Math.ceil(target - Math.max(0, item.qty)));
}

export interface StockLine {
  item: ManageoStockItem;
  threshold: number;
  perDay: number;
  /** Jours avant rupture au rythme actuel ; null si l'article ne se vend pas. */
  daysLeft: number | null;
  ruptureDate: string | null;
  toOrder: number;
}

export interface StockAnalysis {
  low: StockLine[];
  /** Pas encore sous le seuil, mais en rupture dans l'horizon au rythme des ventes. */
  ruptures: StockLine[];
}

export function analyzeStock(
  items: ManageoStockItem[],
  consumption: ManageoConsumption[],
  today: string,
  horizonDays: number,
): StockAnalysis {
  const low: StockLine[] = [];
  const ruptures: StockLine[] = [];
  for (const item of items) {
    const perDay = dailyConsumption(item.id, consumption, today);
    const daysLeft = perDay > 0 ? Math.max(0, item.qty) / perDay : null;
    const line: StockLine = {
      item,
      threshold: stockThreshold(item),
      perDay,
      daysLeft,
      ruptureDate: daysLeft === null ? null : addDays(today, Math.floor(daysLeft)),
      toOrder: orderQuantity(item, perDay),
    };
    if (isLow(item)) low.push(line);
    else if (daysLeft !== null && daysLeft <= horizonDays) ruptures.push(line);
  }
  const byUrgency = (a: StockLine, b: StockLine) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
  return { low: low.sort(byUrgency), ruptures: ruptures.sort(byUrgency) };
}

/** Lignes d'un bon de commande, regroupées par fournisseur. */
export function groupBySupplier(lines: StockLine[]): Map<string, StockLine[]> {
  const groups = new Map<string, StockLine[]>();
  for (const line of lines.filter((l) => l.toOrder > 0)) {
    const supplier = line.item.supplier?.name ?? "Fournisseur non renseigné";
    groups.set(supplier, [...(groups.get(supplier) ?? []), line]);
  }
  return groups;
}

// --- Planning de l'équipe ---------------------------------------------------

/** « 08:30 » → 510 ; « 24:00 » (minuit en fin de service) → 1440. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

type Range = [number, number];

/** Intervalle [début, fin) d'un service ; un service qui passe minuit est coupé à minuit. */
function range(start: string, end: string): Range {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return [s, e <= s ? 1440 : e];
}

function subtract(base: Range[], remove: Range[]): Range[] {
  let out = base;
  for (const [rs, re] of remove) {
    out = out.flatMap(([s, e]) => {
      if (re <= s || rs >= e) return [[s, e] as Range];
      const parts: Range[] = [];
      if (rs > s) parts.push([s, rs]);
      if (re < e) parts.push([re, e]);
      return parts;
    });
  }
  return out;
}

export interface CoverageGap {
  date: string;
  start: string;
  end: string;
  /** Personnes absentes ce jour-là qui étaient prévues. */
  absent: string[];
  /** Qui appeler : disponibles sur tout le créneau, pas déjà en poste, les moins chargés d'abord. */
  suggestions: string[];
}

/**
 * Trous dans le planning d'un jour : heures d'ouverture sans personne en poste,
 * une fois les absences retirées. Les trous de moins de 15 minutes sont ignorés.
 */
export function coverageGaps(planning: ManageoPlanning, date: string): CoverageGap[] {
  const absentIds = new Set(planning.absences.filter((a) => a.date === date).map((a) => a.user_id));
  const shiftsToday = planning.shifts.filter((s) => s.date === date);
  const present = shiftsToday.filter((s) => !absentIds.has(s.user_id));
  const absentScheduled = [...new Set(shiftsToday.filter((s) => absentIds.has(s.user_id)).map((s) => s.name))];

  const opening = planning.ouverture.filter((o) => o.date === date).map((o) => range(o.start, o.end));
  const gaps = subtract(opening, present.map((s) => range(s.start, s.end))).filter(([s, e]) => e - s >= 15);

  // Charge de la semaine, pour proposer d'abord ceux qui ont le moins d'heures.
  const load = new Map<number, number>();
  for (const s of planning.shifts) {
    const [a, b] = range(s.start, s.end);
    load.set(s.user_id, (load.get(s.user_id) ?? 0) + (b - a));
  }

  return gaps.map(([s, e]) => {
    const busy = new Set(present.filter((p) => { const [a, b] = range(p.start, p.end); return a < e && b > s; }).map((p) => p.user_id));
    const suggestions = planning.disponibilites
      .filter((d) => d.date === date && !absentIds.has(d.user_id) && !busy.has(d.user_id))
      .filter((d) => { const [a, b] = range(d.start, d.end); return a <= s && b >= e; })
      .sort((x, y) => (load.get(x.user_id) ?? 0) - (load.get(y.user_id) ?? 0))
      .map((d) => d.name);
    return {
      date,
      start: fromMinutes(s),
      end: fromMinutes(e),
      absent: absentScheduled,
      suggestions: [...new Set(suggestions)].slice(0, 3),
    };
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
