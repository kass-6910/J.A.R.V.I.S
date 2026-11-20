import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { isManageoConfigured, manageo } from "../connectors/manageo/client.js";
import type { ManageoConsumption, ManageoPlanning, ManageoSalesDay, ManageoStockItem } from "../connectors/manageo/types.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { purchaseOrders, type PurchaseOrderLine } from "../db/schema.js";
import { now, zone } from "../lib/time.js";
import {
  analyzeStock,
  coverageGaps,
  groupBySupplier,
  type CoverageGap,
  type StockLine,
} from "../manageo/analysis.js";
import { requestValidation, supersedePendingActions } from "./actions.js";
import { getValue, setValue } from "./kv.js";
import { createTask } from "./tasks.js";

/** Les deux boutiques LMDD suivies par Jarvis, chacune rattachée à son espace. */
export const SHOPS = [
  { slug: "lmdd-confluence", name: "LMDD Confluence" },
  { slug: "lmdd-croix-rousse", name: "LMDD Croix-Rousse" },
] as const;
export type ShopSlug = (typeof SHOPS)[number]["slug"];

const shopName = (slug: ShopSlug) => SHOPS.find((s) => s.slug === slug)!.name;

export { isManageoConfigured };

/** Identifiant Manageo de chaque boutique : MANAGEO_SHOPS s'il est renseigné, sinon le slug de Manageo. */
async function shopIds(): Promise<Map<ShopSlug, number>> {
  const ids = new Map<ShopSlug, number>();
  if (config.MANAGEO_SHOPS) {
    for (const pair of config.MANAGEO_SHOPS.split(",")) {
      const [slug, id] = pair.split(":").map((s) => s.trim());
      if (SHOPS.some((s) => s.slug === slug) && id) ids.set(slug as ShopSlug, Number(id));
    }
    return ids;
  }
  const remote = await manageo.shops();
  for (const shop of SHOPS) {
    const match = remote.find((r) => r.slug === shop.slug);
    if (match) ids.set(shop.slug, match.id);
  }
  return ids;
}

/** Ce que Jarvis garde de Manageo, relevé toutes les 15 minutes. */
interface Snapshot {
  fetchedAt: string;
  today: string;
  stock: ManageoStockItem[];
  consumption: ManageoConsumption[];
  yesterday: ManageoSalesDay;
  lastWeek: ManageoSalesDay;
  plannings: ManageoPlanning[];
}

async function fetchSnapshot(shopId: number): Promise<Snapshot> {
  const today = now().startOf("day");
  const iso = (d: DateTime) => d.toISODate()!;
  const weeks = [...new Set([today, today.plus({ days: 1 })].map((d) => iso(d.startOf("week"))))];
  const [stock, consumption, yesterday, lastWeek, plannings] = await Promise.all([
    manageo.stock(shopId),
    manageo.consumption(shopId, iso(today.minus({ days: 14 })), iso(today)),
    manageo.salesDay(shopId, iso(today.minus({ days: 1 }))),
    manageo.salesDay(shopId, iso(today.minus({ days: 8 }))),
    Promise.all(weeks.map((w) => manageo.planning(shopId, w))),
  ]);
  return { fetchedAt: new Date().toISOString(), today: iso(today), stock, consumption, yesterday, lastWeek, plannings };
}

async function loadSnapshot(slug: ShopSlug): Promise<Snapshot | null> {
  const raw = await getValue(`manageo:snapshot:${slug}`);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

export interface ShopStatus {
  slug: ShopSlug;
  name: string;
  fetchedAt: string;
  sales: { yesterday: ManageoSalesDay; lastWeek: ManageoSalesDay };
  low: StockLine[];
  ruptures: StockLine[];
  gapsToday: CoverageGap[];
  gapsTomorrow: CoverageGap[];
  /** La semaine de demain n'est pas encore publiée pour l'équipe. */
  unpublishedWeek: string | null;
}

function analyze(slug: ShopSlug, snap: Snapshot): ShopStatus {
  const { low, ruptures } = analyzeStock(snap.stock, snap.consumption, snap.today, config.STOCK_RUPTURE_HORIZON_DAYS);
  const tomorrow = DateTime.fromISO(snap.today, { zone }).plus({ days: 1 }).toISODate()!;
  const planningFor = (date: string) => snap.plannings.find((p) => p.ouverture.some((o) => o.date === date) || p.shifts.some((s) => s.date === date));
  const gapsFor = (date: string) => {
    const planning = planningFor(date);
    return planning ? coverageGaps(planning, date) : [];
  };
  const unpublished = snap.plannings.find((p) => !p.published);
  return {
    slug,
    name: shopName(slug),
    fetchedAt: snap.fetchedAt,
    sales: { yesterday: snap.yesterday, lastWeek: snap.lastWeek },
    low,
    ruptures,
    gapsToday: gapsFor(snap.today),
    gapsTomorrow: gapsFor(tomorrow),
    unpublishedWeek: unpublished?.week_start ?? null,
  };
}

/** État des boutiques d'après le dernier relevé (sans appeler Manageo). */
export async function shopStatuses(): Promise<ShopStatus[]> {
  if (!isManageoConfigured()) return [];
  const out: ShopStatus[] = [];
  for (const shop of SHOPS) {
    const snap = await loadSnapshot(shop.slug);
    if (snap) out.push(analyze(shop.slug, snap));
  }
  return out;
}

export async function shopStatus(slug: ShopSlug): Promise<ShopStatus | null> {
  const snap = await loadSnapshot(slug);
  return snap ? analyze(slug, snap) : null;
}

// --- Alertes ------------------------------------------------------------------

function unitQty(qty: number, unit: string | null): string {
  const rounded = Math.round(qty * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/** Envoie une alerte pour chaque nouveauté (stock bas, rupture prévue, trou de planning), une seule fois. */
async function alertChanges(status: ShopStatus): Promise<void> {
  const key = `manageo:alerted:${status.slug}`;
  const already = new Set<string>(JSON.parse((await getValue(key)) ?? "[]"));
  const current = new Map<string, string>();
  for (const l of status.low) {
    current.set(`low:${l.item.id}`, `${l.item.name} : ${unitQty(l.item.qty, l.item.unit)} (seuil ${unitQty(l.threshold, l.item.unit)})`);
  }
  for (const l of status.ruptures) {
    current.set(`rupture:${l.item.id}`, `${l.item.name} : plus rien dans ${Math.floor(l.daysLeft!)} jour(s) au rythme des ventes`);
  }
  for (const g of [...status.gapsToday, ...status.gapsTomorrow]) {
    const when = status.gapsToday.includes(g) ? "aujourd'hui" : "demain";
    const who = g.suggestions.length > 0 ? ` Appeler : ${g.suggestions.join(", ")}.` : "";
    const why = g.absent.length > 0 ? ` (${g.absent.join(", ")} absent)` : "";
    current.set(`gap:${g.date}:${g.start}-${g.end}`, `Personne de ${g.start} à ${g.end} ${when}${why}.${who}`);
  }

  const fresh = [...current].filter(([id]) => !already.has(id));
  if (fresh.length > 0 && isNotifyConfigured()) {
    await sendNotification({
      title: `${status.name}`,
      message: fresh.map(([, text]) => text).join("\n"),
      priority: fresh.some(([id]) => id.startsWith("low:") || id.startsWith("gap:")) ? 4 : 3,
      tags: ["shopping_cart"],
    });
  }
  // On oublie ce qui est réglé : une nouvelle baisse sous le seuil sera de nouveau signalée.
  await setValue(key, JSON.stringify([...current.keys()]));
}

// --- Bons de commande -------------------------------------------------------------

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

function describeOrder(order: { shop: string; supplier: string; lines: PurchaseOrderLine[] }): string {
  const lines = order.lines.map((l) => `- ${l.name} : ${unitQty(l.qty, l.unit)} (${l.reason})`);
  return `Commande ${order.supplier} pour ${shopName(order.shop as ShopSlug)} :\n${lines.join("\n")}`;
}

/**
 * Prépare un bon de commande par fournisseur à partir du stock bas et des ruptures prévues.
 * Un bon identique n'est pas reproposé dans les 24 heures ; un nouveau bon remplace l'ancien en attente.
 */
export async function proposeOrders(status: ShopStatus, options: { force?: boolean } = {}): Promise<PurchaseOrder[]> {
  const created: PurchaseOrder[] = [];
  const groups = groupBySupplier([...status.low, ...status.ruptures]);
  for (const [supplier, lines] of groups) {
    const orderLines: PurchaseOrderLine[] = lines.map((l) => ({
      itemId: l.item.id,
      name: l.item.name,
      unit: l.item.unit,
      qty: l.toOrder,
      current: l.item.qty,
      reason: status.low.includes(l)
        ? `reste ${unitQty(l.item.qty, l.item.unit)}, seuil ${unitQty(l.threshold, l.item.unit)}`
        : `rupture prévue dans ${Math.floor(l.daysLeft!)} jour(s)`,
    }));
    const signature = orderLines.map((l) => l.itemId).sort((a, b) => a - b).join(",");
    const recent = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.shop, status.slug),
        eq(purchaseOrders.supplier, supplier),
        gte(purchaseOrders.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
      orderBy: desc(purchaseOrders.createdAt),
    });
    if (!options.force && recent && recent.signature === signature) continue;

    const previous = await db
      .update(purchaseOrders)
      .set({ status: "superseded", resolvedAt: new Date() })
      .where(and(eq(purchaseOrders.shop, status.slug), eq(purchaseOrders.supplier, supplier), eq(purchaseOrders.status, "pending")))
      .returning({ id: purchaseOrders.id });
    await supersedePendingActions("purchase_order", "order_id", previous.map((p) => p.id));

    const [order] = await db
      .insert(purchaseOrders)
      .values({ shop: status.slug, supplier, lines: orderLines, signature })
      .returning();
    await requestValidation("purchase_order", { order_id: order!.id }, describeOrder(order!));
    created.push(order!);
  }
  return created;
}

/** Bon validé : Jarvis ajoute la tâche de passer la commande (Manageo n'a pas encore de bons de commande boutique). */
export async function validateOrder(orderId: string): Promise<void> {
  const [order] = await db
    .update(purchaseOrders)
    .set({ status: "validated", resolvedAt: new Date() })
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.status, "pending")))
    .returning();
  if (!order) throw new Error("Ce bon de commande n'est plus en attente.");
  await createTask({
    title: `Passer la commande ${order.supplier} (${shopName(order.shop as ShopSlug)}) : ${order.lines.map((l) => `${l.name} ${unitQty(l.qty, l.unit)}`).join(", ")}`,
    durationMin: 15,
    priority: "high",
    spaces: [order.shop as ShopSlug],
  });
}

export async function rejectOrder(orderId: string): Promise<void> {
  await db.update(purchaseOrders).set({ status: "rejected", resolvedAt: new Date() }).where(eq(purchaseOrders.id, orderId));
}

// --- Relève -------------------------------------------------------------------

/** Relève Manageo, alerte sur les nouveautés et prépare les bons de commande. */
export async function checkManageo(): Promise<void> {
  if (!isManageoConfigured()) return;
  const ids = await shopIds();
  for (const shop of SHOPS) {
    const id = ids.get(shop.slug);
    if (id === undefined) {
      console.error(`Manageo : boutique « ${shop.slug} » introuvable (voir MANAGEO_SHOPS).`);
      continue;
    }
    try {
      const snap = await fetchSnapshot(id);
      await setValue(`manageo:snapshot:${shop.slug}`, JSON.stringify(snap));
      const status = analyze(shop.slug, snap);
      await alertChanges(status);
      await proposeOrders(status);
    } catch (err) {
      console.error(`Manageo : relève de ${shop.name} impossible :`, err);
    }
  }
}

// --- Textes pour le briefing et Claude ----------------------------------------------

function euros(value: number): string {
  return `${Math.round(value).toLocaleString("fr-FR")} €`;
}

export function describeSales(status: ShopStatus): string {
  const { yesterday, lastWeek } = status.sales;
  const diff = lastWeek.ca > 0 ? Math.round(((yesterday.ca - lastWeek.ca) / lastWeek.ca) * 100) : null;
  const trend = diff === null ? "" : ` (${diff >= 0 ? "+" : ""}${diff} % par rapport au même jour la semaine dernière)`;
  return `chiffre d'affaires d'hier : ${euros(yesterday.ca)}, ${yesterday.commandes} commande(s)${trend}`;
}

export function describeShop(status: ShopStatus): string[] {
  const lines = [`${status.name} (relevé ${DateTime.fromISO(status.fetchedAt, { zone }).toFormat("HH:mm")}) :`];
  lines.push(`- ${describeSales(status)}`);
  if (status.low.length > 0) {
    lines.push(`- stock bas : ${status.low.map((l) => `${l.item.name} (${unitQty(l.item.qty, l.item.unit)})`).join(", ")}`);
  }
  if (status.ruptures.length > 0) {
    lines.push(`- ruptures prévues : ${status.ruptures.map((l) => `${l.item.name} dans ${Math.floor(l.daysLeft!)} jour(s)`).join(", ")}`);
  }
  for (const [label, gaps] of [["aujourd'hui", status.gapsToday], ["demain", status.gapsTomorrow]] as const) {
    for (const g of gaps) {
      lines.push(
        `- planning ${label} : personne de ${g.start} à ${g.end}${g.absent.length ? ` (${g.absent.join(", ")} absent)` : ""}${g.suggestions.length ? ` ; disponibles : ${g.suggestions.join(", ")}` : " ; aucun disponible connu"}`,
      );
    }
  }
  if (status.unpublishedWeek) lines.push(`- le planning de la semaine du ${status.unpublishedWeek} n'est pas publié pour l'équipe`);
  return lines;
}

export async function manageoFacts(): Promise<string[]> {
  if (!isManageoConfigured()) return ["Boutiques LMDD : Manageo n'est pas encore connecté."];
  const statuses = await shopStatuses();
  if (statuses.length === 0) return ["Boutiques LMDD : pas encore de relevé de Manageo."];
  return ["Boutiques LMDD :", ...statuses.flatMap(describeShop)];
}
