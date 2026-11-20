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
  /** Manageo : API dédiée à Jarvis (clé en lecture seule), voir docs/manageo-api.md. */
  MANAGEO_URL: z.string().default(""),
  MANAGEO_API_KEY: z.string().default(""),
  /** Facultatif : « lmdd-confluence:12,lmdd-croix-rousse:14 ». Sinon, les boutiques sont reconnues par leur slug. */
  MANAGEO_SHOPS: z.string().default(""),
  STOCK_RUPTURE_HORIZON_DAYS: z.coerce.number().int().min(1).max(14).default(3),
  /** Sport : séances par semaine, durée, et heure à partir de laquelle Jarvis préfère les placer. */
  SPORT_SESSIONS_PER_WEEK: z.coerce.number().int().min(0).max(7).default(3),
  SPORT_DURATION_MIN: z.coerce.number().int().min(15).max(180).default(60),
  SPORT_PREFERRED_START: hhmm.default("18:00"),
  /** Heures des repas par défaut (avant que le module repas ne les place) : rappels des compléments. */
  MEAL_TIMES: z.string().default("matin=08:00,midi=12:30,collation=16:30,soir=19:30"),
  /** Objectif de prise de poids : calories et protéines par jour, préférences pour les menus. */
  MEAL_KCAL_TARGET: z.coerce.number().int().min(1200).max(6000).default(3000),
  MEAL_PROTEIN_G: z.coerce.number().int().min(30).max(400).default(140),
  MEAL_PREFERENCES: z.string().default("halal (ni porc ni alcool), cuisine simple, moins de 30 minutes en semaine"),
  /** Plafond des dépenses perso du mois, en euros ; 0 = pas d'alerte. */
  BUDGET_MONTHLY_EUR: z.coerce.number().min(0).default(0),
  /** Dossier des fichiers de Jarvis (photos de factures, de vêtements). */
  DATA_DIR: z.string().default("data"),
  /** Prière : horaires calculés par Aladhan pour Lyon ; méthode 12 = UOIF (France). */
  PRAYER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  PRAYER_LATITUDE: z.coerce.number().default(45.764),
  PRAYER_LONGITUDE: z.coerce.number().default(4.8357),
  PRAYER_METHOD: z.coerce.number().int().default(12),
  PRAYER_DURATION_MIN: z.coerce.number().int().min(5).max(90).default(15),
  PRAYER_NOTIFY_BEFORE_MIN: z.coerce.number().int().min(0).max(60).default(10),
  /** Recueils du rappel quotidien (éditions françaises de la collection de hadiths publiée). */
  HADITH_EDITIONS: z.string().default("fra-bukhari,fra-muslim,fra-nawawi"),
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
