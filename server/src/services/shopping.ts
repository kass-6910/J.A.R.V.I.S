import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { shoppingItems } from "../db/schema.js";
import { NotFoundError } from "./tasks.js";

export type ShoppingItem = typeof shoppingItems.$inferSelect;
type Source = ShoppingItem["source"];

/**
 * Ajoute un article à la liste. Un article déjà présent (même nom, pas encore acheté)
 * n'est pas dupliqué : sa quantité est mise à jour si une nouvelle est donnée.
 */
export async function addShoppingItem(input: {
  name: string;
  qty?: string | null;
  source: Source;
  refType?: string;
  refId?: string;
}): Promise<ShoppingItem> {
  const name = input.name.trim();
  const existing = await db.query.shoppingItems.findFirst({
    where: and(isNull(shoppingItems.checkedAt), sql`lower(${shoppingItems.name}) = lower(${name})`),
  });
  if (existing) {
    if (!input.qty) return existing;
    const [row] = await db.update(shoppingItems).set({ qty: input.qty }).where(eq(shoppingItems.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db
    .insert(shoppingItems)
    .values({ name, qty: input.qty ?? null, source: input.source, refType: input.refType ?? null, refId: input.refId ?? null })
    .returning();
  return row!;
}

/** À acheter, puis ce qui a été acheté ces trois derniers jours. */
export async function listShopping(): Promise<{ toBuy: ShoppingItem[]; bought: ShoppingItem[] }> {
  const [toBuy, bought] = await Promise.all([
    db.select().from(shoppingItems).where(isNull(shoppingItems.checkedAt)).orderBy(asc(shoppingItems.createdAt)),
    db
      .select()
      .from(shoppingItems)
      .where(and(isNotNull(shoppingItems.checkedAt), gte(shoppingItems.checkedAt, new Date(Date.now() - 3 * 86_400_000))))
      .orderBy(desc(shoppingItems.checkedAt)),
  ]);
  return { toBuy, bought };
}

export async function setShoppingChecked(id: string, checked: boolean): Promise<ShoppingItem> {
  const [row] = await db
    .update(shoppingItems)
    .set({ checkedAt: checked ? new Date() : null })
    .where(eq(shoppingItems.id, id))
    .returning();
  if (!row) throw new NotFoundError("Article introuvable.");
  return row;
}

export async function removeShoppingItem(id: string): Promise<void> {
  const deleted = await db.delete(shoppingItems).where(eq(shoppingItems.id, id)).returning({ id: shoppingItems.id });
  if (deleted.length === 0) throw new NotFoundError("Article introuvable.");
}

export async function getShoppingItem(id: string): Promise<ShoppingItem | null> {
  return (await db.query.shoppingItems.findFirst({ where: eq(shoppingItems.id, id) })) ?? null;
}
