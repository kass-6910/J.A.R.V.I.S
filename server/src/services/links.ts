import { and, eq, inArray } from "drizzle-orm";
import { db, type SpaceSlug } from "../db/client.js";
import { itemsLinks, spaces } from "../db/schema.js";

/** Types d'éléments rattachables à un ou plusieurs espaces. */
export type ItemType = "task" | "mail";

export async function spacesOf(itemType: ItemType, ids: string[]): Promise<Map<string, SpaceSlug[]>> {
  const result = new Map<string, SpaceSlug[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const rows = await db
    .select({ itemId: itemsLinks.itemId, slug: spaces.slug })
    .from(itemsLinks)
    .innerJoin(spaces, eq(spaces.id, itemsLinks.spaceId))
    .where(and(eq(itemsLinks.itemType, itemType), inArray(itemsLinks.itemId, ids)))
    .orderBy(spaces.position);
  for (const row of rows) result.get(row.itemId)?.push(row.slug as SpaceSlug);
  return result;
}

export async function setItemSpaces(itemType: ItemType, itemId: string, slugs: SpaceSlug[]): Promise<void> {
  await db.delete(itemsLinks).where(and(eq(itemsLinks.itemType, itemType), eq(itemsLinks.itemId, itemId)));
  if (slugs.length === 0) return;
  const rows = await db.select().from(spaces).where(inArray(spaces.slug, slugs));
  await db.insert(itemsLinks).values(rows.map((s) => ({ itemType, itemId, spaceId: s.id })));
}

export async function removeItem(itemType: ItemType, itemId: string): Promise<void> {
  await db.delete(itemsLinks).where(and(eq(itemsLinks.itemType, itemType), eq(itemsLinks.itemId, itemId)));
}
