import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
export const db = drizzle(pool, { schema });

const SPACES = [
  { slug: "lmdd-confluence", name: "LMDD Confluence", color: "#5B8DEF" },
  { slug: "lmdd-croix-rousse", name: "LMDD Croix-Rousse", color: "#E07AA8" },
  { slug: "manageo", name: "Manageo", color: "#E0A43A" },
  { slug: "ecole", name: "École", color: "#9A86E8" },
  { slug: "vie-perso", name: "Vie perso", color: "#4FBF8B" },
] as const;

export type SpaceSlug = (typeof SPACES)[number]["slug"];
export const SPACE_SLUGS = SPACES.map((s) => s.slug) as [SpaceSlug, ...SpaceSlug[]];

/** Applique les migrations et crée les 5 espaces s'ils n'existent pas. */
export async function prepareDatabase(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: join(here, "../../drizzle") });
  await db
    .insert(schema.spaces)
    .values(SPACES.map((s, position) => ({ ...s, position })))
    .onConflictDoNothing({ target: schema.spaces.slug });
}
