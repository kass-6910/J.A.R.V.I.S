import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { kvStore } from "../db/schema.js";

export async function getValue(key: string): Promise<string | null> {
  const row = await db.query.kvStore.findFirst({ where: eq(kvStore.key, key) });
  return row?.value ?? null;
}

export async function setValue(key: string, value: string): Promise<void> {
  await db
    .insert(kvStore)
    .values({ key, value })
    .onConflictDoUpdate({ target: kvStore.key, set: { value, updatedAt: new Date() } });
}
