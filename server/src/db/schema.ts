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
  (t) => [index("schedule_blocks_day_idx").on(t.day)],
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
