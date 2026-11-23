import {
  boolean,
  uniqueIndex,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const spaces = pgTable("spaces", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  color: text().notNull(),
  position: integer().notNull().default(0),
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    priority: text({ enum: PRIORITIES }).notNull().default("normal"),
    deadline: timestamp({ withTimezone: true }),
    status: text({ enum: ["todo", "done"] }).notNull().default("todo"),
    /** « Cette tâche passe avant celle-là » : ordre explicite donné par Jessim. */
    beforeTaskId: uuid("before_task_id"),
    /** Temps réellement passé, pour apprendre à mieux estimer. */
    actualMin: integer("actual_min"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Pas avant ce jour : la tâche n'est placée dans le planning qu'à partir de là (révisions…). */
    notBefore: date("not_before"),
    /** Alerte « échéance proche » déjà envoyée ; remis à zéro si l'échéance change. */
    deadlineAlertedAt: timestamp("deadline_alerted_at", { withTimezone: true }),
  },
  (t) => [index("tasks_status_idx").on(t.status)],
);

/** Lien entre un élément (tâche aujourd'hui, mail ou alerte plus tard) et un ou plusieurs espaces. */
export const itemsLinks = pgTable(
  "items_links",
  {
    itemType: text("item_type").notNull(),
    itemId: uuid("item_id").notNull(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemType, t.itemId, t.spaceId] })],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: uuid().primaryKey().defaultRandom(),
    day: date().notNull(),
    kind: text({ enum: ["task", "sport", "meal", "prayer"] }).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    protected: boolean().notNull().default(false),
  },
  (t) => [
    index("schedule_blocks_day_idx").on(t.day),
    // Un seul créneau de chaque prière par jour : la création reste idempotente.
    uniqueIndex("schedule_blocks_prayer_idx").on(t.day, t.title).where(sql`kind = 'prayer'`),
  ],
);

/** Historique de chaque action de Jarvis, avec son statut de validation. */
export const actionsLog = pgTable("actions_log", {
  id: uuid().primaryKey().defaultRandom(),
  tool: text().notNull(),
  input: jsonb().notNull(),
  summary: text().notNull(),
  status: text({ enum: ["executed", "pending", "confirmed", "rejected"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const REMINDER_LEVELS = ["notification", "iphone", "alarm"] as const;
export type ReminderLevel = (typeof REMINDER_LEVELS)[number];

/**
 * Rappels demandés à Jarvis. Trois niveaux de livraison (cahier des charges, §9) :
 * - notification : envoyée par le serveur (ntfy) à l'heure dite ;
 * - iphone : créée par le Raccourci dans l'app Rappels, fonctionne même serveur éteint ;
 * - alarm : créée par le Raccourci dans l'app Horloge (« réveille-moi », « c'est urgent »).
 */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    level: text({ enum: REMINDER_LEVELS }).notNull(),
    /** scheduled : le serveur l'enverra ; on_device : confiée à l'iPhone ; sent / failed / cancelled : terminée. */
    status: text({ enum: ["scheduled", "on_device", "sent", "failed", "cancelled"] }).notNull(),
    attempts: integer().notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("reminders_due_idx").on(t.status, t.remindAt)],
);

/** Briefing du matin et bilan du soir, un de chaque par jour. */
export const briefings = pgTable(
  "briefings",
  {
    id: uuid().primaryKey().defaultRandom(),
    day: date().notNull(),
    kind: text({ enum: ["morning", "evening"] }).notNull(),
    text: text().notNull(),
    /** claude : rédigé par Claude ; template : version de secours si Claude était injoignable. */
    source: text({ enum: ["claude", "template"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("briefings_day_kind_idx").on(t.day, t.kind)],
);

export const MAIL_PROVIDERS = ["gmail", "outlook"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const MAIL_IMPORTANCE = ["high", "normal", "low"] as const;

export interface SchoolEvent {
  kind: "exam" | "deadline" | "schedule_change" | "other";
  title: string;
  /** Date ISO 8601 si le mail en donne une. */
  date: string | null;
}

/** Mails relevés dans Gmail et l'Outlook de l'école. Jarvis ne modifie jamais la boîte d'origine. */
export const mails = pgTable(
  "mails",
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text({ enum: MAIL_PROVIDERS }).notNull(),
    externalId: text("external_id").notNull(),
    threadId: text("thread_id"),
    /** En-tête Message-ID, pour répondre dans le même fil. */
    messageIdHeader: text("message_id_header"),
    fromName: text("from_name").notNull(),
    fromAddress: text("from_address").notNull(),
    /** Adresse à qui répondre (Reply-To, sinon l'expéditeur). */
    replyAddress: text("reply_address").notNull(),
    subject: text().notNull(),
    snippet: text().notNull(),
    body: text().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    unread: boolean().notNull(),
    /** Tri : null tant que le mail n'est pas trié. */
    importance: text({ enum: MAIL_IMPORTANCE }),
    summary: text(),
    needsReply: boolean("needs_reply").notNull().default(false),
    schoolEvent: jsonb("school_event").$type<SchoolEvent>(),
    triageSource: text("triage_source", { enum: ["claude", "fallback"] }),
    triageAttempts: integer("triage_attempts").notNull().default(0),
    /** Notification « mail important » déjà envoyée. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Marqué comme traité dans Jarvis (la boîte mail n'est pas touchée). */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mails_provider_external_idx").on(t.provider, t.externalId),
    index("mails_received_idx").on(t.receivedAt),
  ],
);

/** Réponses proposées par Jarvis ; envoyées seulement après validation de Jessim. */
export const mailDrafts = pgTable("mail_drafts", {
  id: uuid().primaryKey().defaultRandom(),
  mailId: uuid("mail_id")
    .notNull()
    .references(() => mails.id, { onDelete: "cascade" }),
  body: text().notNull(),
  status: text({ enum: ["pending", "sent", "rejected"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

/** Petites valeurs persistantes : dernière relève des mails, jetons OAuth renouvelés... */
export const kvStore = pgTable("kv_store", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type Prayer = (typeof PRAYERS)[number];

/** Horaires de prière d'un jour, tels que calculés par Aladhan (ISO 8601). */
export const prayerTimes = pgTable("prayer_times", {
  day: date().primaryKey(),
  timings: jsonb().$type<Record<Prayer, string>>().notNull(),
  method: integer().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Rappel religieux du jour : un hadith tiré d'un recueil publié, jamais rédigé par l'IA. */
export const dailyHadith = pgTable("daily_hadith", {
  day: date().primaryKey(),
  edition: text().notNull(),
  collection: text().notNull(),
  number: text().notNull(),
  text: text().notNull(),
  grade: text(),
});

/** Données Santé d'une journée (Apple Watch via l'app Santé). Le sommeil est rattaché au jour du réveil. */
export const healthDays = pgTable("health_days", {
  day: date().primaryKey(),
  steps: integer(),
  activeKcal: integer("active_kcal"),
  sleepMin: integer("sleep_min"),
  sleepStart: timestamp("sleep_start", { withTimezone: true }),
  sleepEnd: timestamp("sleep_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Séances enregistrées par la montre. */
export const workouts = pgTable(
  "workouts",
  {
    id: uuid().primaryKey().defaultRandom(),
    type: text().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    kcal: integer(),
  },
  (t) => [uniqueIndex("workouts_start_type_idx").on(t.startsAt, t.type)],
);

export interface PurchaseOrderLine {
  itemId: number;
  name: string;
  unit: string | null;
  qty: number;
  current: number;
  reason: string;
}

/** Bons de commande préparés par Jarvis à partir des stocks Manageo ; validés par Jessim. */
export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid().primaryKey().defaultRandom(),
  shop: text().notNull(),
  supplier: text().notNull(),
  lines: jsonb().$type<PurchaseOrderLine[]>().notNull(),
  /** Articles concernés : un même bon n'est pas reproposé tant que la situation ne change pas. */
  signature: text().notNull(),
  status: text({ enum: ["pending", "validated", "rejected", "superseded"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/** Liste de courses partagée : à la voix, depuis l'app, ou ajoutée par les soins, compléments et menus. */
export const shoppingItems = pgTable("shopping_items", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  qty: text(),
  source: text({ enum: ["voix", "app", "soins", "complement", "menu"] }).notNull(),
  /** Élément à l'origine de l'ajout (soin, complément, menu), pour le mettre à jour quand c'est acheté. */
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Soins récurrents que Jessim oublie : rendez-vous (coiffeur) ou produit à racheter (brosse à dents). */
export const careItems = pgTable("care_items", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  kind: text({ enum: ["rendez_vous", "produit"] }).notNull(),
  everyDays: integer("every_days").notNull(),
  durationMin: integer("duration_min").notNull().default(45),
  lastDoneOn: date("last_done_on"),
  /** Tâche ou article de courses créé pour l'échéance en cours. */
  pendingTaskId: uuid("pending_task_id"),
  pendingShoppingId: uuid("pending_shopping_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplements = pgTable("supplements", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  moment: text({ enum: ["matin", "midi", "soir", "avant_sport", "apres_sport"] }).notNull(),
  withMeal: boolean("with_meal").notNull().default(true),
  /** Doses restantes ; null si Jessim ne veut pas suivre le stock. */
  stockDoses: integer("stock_doses"),
  lowAt: integer("low_at").notNull().default(7),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Une prise par complément et par jour : rappel, rappel discret, confirmation « pris ». */
export const supplementIntakes = pgTable(
  "supplement_intakes",
  {
    id: uuid().primaryKey().defaultRandom(),
    supplementId: uuid("supplement_id")
      .notNull()
      .references(() => supplements.id, { onDelete: "cascade" }),
    day: date().notNull(),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    nudgedAt: timestamp("nudged_at", { withTimezone: true }),
    takenAt: timestamp("taken_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("supplement_intakes_day_idx").on(t.supplementId, t.day)],
);

/** Papiers et échéances administratives (CAF, bail, déclarations, factures). */
export const adminDeadlines = pgTable("admin_deadlines", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  dueOn: date("due_on").notNull(),
  remindDays: integer("remind_days").notNull().default(7),
  notes: text(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Proches : anniversaire, et fréquence à laquelle Jessim veut les appeler. */
export const contacts = pgTable("contacts", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  relation: text(),
  /** « MM-JJ ». */
  birthday: text(),
  birthYear: integer("birth_year"),
  callEveryDays: integer("call_every_days"),
  lastContactOn: date("last_contact_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Routines du matin et du soir, en option, avec un rappel discret. */
export const routines = pgTable("routines", {
  moment: text({ enum: ["matin", "soir"] }).primaryKey(),
  time: text().notNull(),
  items: text().notNull(),
});

/** Menus prévus, un par créneau et par jour. */
export const mealPlans = pgTable(
  "meal_plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    day: date().notNull(),
    slot: text({ enum: ["matin", "midi", "collation", "soir"] }).notNull(),
    title: text().notNull(),
    description: text().notNull(),
    kcal: integer().notNull(),
    proteinG: integer("protein_g").notNull(),
    ingredients: jsonb().$type<{ name: string; qty: string }[]>().notNull(),
    source: text({ enum: ["claude", "template"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meal_plans_day_slot_idx").on(t.day, t.slot)],
);

/** Dépenses : perso (budget du mois) ou professionnelles (rattachées à une boutique ou à Manageo). */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid().primaryKey().defaultRandom(),
    spentOn: date("spent_on").notNull(),
    amountCents: integer("amount_cents").notNull(),
    label: text().notNull(),
    merchant: text(),
    category: text().notNull(),
    /** Espace : vie-perso compte dans le budget du mois ; les autres sont des dépenses pro. */
    space: text().notNull().default("vie-perso"),
    source: text({ enum: ["voix", "app", "photo", "abonnement"] }).notNull(),
    receiptFile: text("receipt_file"),
    subscriptionId: uuid("subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_spent_on_idx").on(t.spentOn),
    // Un abonnement n'est compté qu'une fois par mois.
    uniqueIndex("expenses_subscription_month_idx").on(t.subscriptionId, t.spentOn).where(sql`subscription_id is not null`),
  ],
);

export const subscriptions = pgTable("subscriptions", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  amountCents: integer("amount_cents").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  category: text().notNull().default("abonnements"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Vêtements de Jessim, une photo chacun, classés par Claude. */
export const wardrobeItems = pgTable("wardrobe_items", {
  id: uuid().primaryKey().defaultRandom(),
  photoFile: text("photo_file").notNull(),
  type: text().notNull(),
  label: text().notNull(),
  color: text().notNull(),
  style: text().notNull(),
  warmth: text().notNull(),
  rainProof: boolean("rain_proof").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tenue proposée chaque jour (sert aussi à ne pas reproposer la tenue de la veille). */
export const outfits = pgTable("outfits", {
  day: date().primaryKey(),
  itemIds: jsonb("item_ids").$type<string[]>().notNull(),
  sportBagId: uuid("sport_bag_id"),
  reason: text().notNull(),
  weather: jsonb().$type<{ minC: number; maxC: number; rainChance: number; summary: string } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Lieux enregistrés : l'iPhone signale l'arrivée et le départ (pas de suivi permanent). */
export const places = pgTable("places", {
  id: uuid().primaryKey().defaultRandom(),
  /** Nom court utilisé par le Raccourci : « salle », « lmdd-confluence », « ecole », « maison »… */
  slug: text().notNull().unique(),
  name: text().notNull(),
  kind: text({ enum: ["salle", "boutique", "ecole", "maison", "autre"] }).notNull(),
  /** Espace concerné (boutique, école), pour afficher ses alertes à l'arrivée. */
  space: text(),
  address: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Arrivées et départs ; seule une présence confirmée déclenche une action. */
export const locationEvents = pgTable("location_events", {
  id: uuid().primaryKey().defaultRandom(),
  placeId: uuid("place_id")
    .notNull()
    .references(() => places.id, { onDelete: "cascade" }),
  event: text({ enum: ["arrivee", "depart"] }).notNull(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** pending : en attente de réponse ; present : « je suis là pour… » ; passing : « de passage ». */
  status: text({ enum: ["pending", "present", "passing", "recorded"] }).notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  /** Séance démarrée à la salle, terminée au départ. */
  workoutId: uuid("workout_id"),
});

/** Examens repérés dans les mails de l'école, l'agenda, ou dictés par Jessim. */
export const exams = pgTable(
  "exams",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    day: date().notNull(),
    /** Heure si connue (« 09:00 »). */
    time: text(),
    source: text({ enum: ["mail", "agenda", "voix"] }).notNull(),
    revisionTaskIds: jsonb("revision_task_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exams_title_day_idx").on(sql`lower(${t.title})`, t.day)],
);

/** Cours fournis en PDF : résumé, fiche de révision et quiz rédigés par Claude. */
export const courses = pgTable("courses", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  subject: text(),
  fileName: text("file_name").notNull(),
  summary: text().notNull(),
  sheet: text().notNull(),
  quiz: jsonb().$type<{ question: string; answer: string }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
