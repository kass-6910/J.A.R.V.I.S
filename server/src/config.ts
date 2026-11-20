import { existsSync } from "node:fs";
import { z } from "zod";

// Le .env vit à la racine du dépôt ; en production les variables viennent de l'environnement.
for (const path of [".env", "../.env"]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format HH:MM attendu");

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  TIMEZONE: z.string().default("Europe/Paris"),
  JARVIS_TOKEN: z.string().min(16, "JARVIS_TOKEN doit faire au moins 16 caractères"),
  DATABASE_URL: z.string().min(1),
  JARVIS_MODEL: z.string().default("claude-sonnet-5-5"),
  JARVIS_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  PLANNING_DAY_START: hhmm.default("08:00"),
  PLANNING_DAY_END: hhmm.default("22:00"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().default(""),
  GOOGLE_CALENDAR_IDS: z.string().default("primary"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Configuration invalide (voir .env.example) :\n${lines.join("\n")}`);
}

export const config = parsed.data;
