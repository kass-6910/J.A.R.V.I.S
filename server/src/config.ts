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
  /** Modèle des petites tâches de fond (tri des mails, classement par espace). */
  JARVIS_BACKGROUND_MODEL: z.string().default("claude-haiku-5-5"),
  JARVIS_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  PLANNING_DAY_START: hhmm.default("08:00"),
  PLANNING_DAY_END: hhmm.default("22:00"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().default(""),
  GOOGLE_CALENDAR_IDS: z.string().default("primary"),
  GMAIL_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  MS_CLIENT_ID: z.string().default(""),
  MS_TENANT: z.string().default("organizations"),
  MS_REFRESH_TOKEN: z.string().default(""),
  /** Adresse publique de la web app, ouverte quand on touche une notification. */
  PUBLIC_URL: z.string().default(""),
  BRIEFING_TIME: hhmm.default("07:00"),
  EVENING_TIME: hhmm.default("21:30"),
  NTFY_URL: z.string().url().default("https://ntfy.sh"),
  NTFY_TOPIC: z.string().default(""),
  NTFY_TOKEN: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Configuration invalide (voir .env.example) :\n${lines.join("\n")}`);
}

export const config = parsed.data;
