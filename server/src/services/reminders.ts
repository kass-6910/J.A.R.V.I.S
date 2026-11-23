import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { reminders, type ReminderLevel } from "../db/schema.js";
import { NotFoundError } from "./tasks.js";

export type Reminder = typeof reminders.$inferSelect;

/** Au-delà, un rappel qui n'arrive pas à partir est abandonné et signalé comme « failed ». */
const MAX_ATTEMPTS = 5;
/** Un rappel en retard de plus d'une heure (serveur arrêté) part quand même, marqué comme tel. */
const LATE_MS = 60 * 60_000;

/**
 * Crée un rappel. « deviceCanCreate » indique si le client (le Raccourci) sait créer
 * lui-même un rappel iPhone ou une alarme ; sinon le serveur s'en charge par notification.
 */
export async function createReminder(input: {
  title: string;
  remindAt: Date;
  level: ReminderLevel;
  deviceCanCreate: boolean;
}): Promise<Reminder> {
  if (input.remindAt.getTime() < Date.now() - 60_000) {
    throw new Error("Cette heure est déjà passée.");
  }
  const onDevice = input.level !== "notification" && input.deviceCanCreate;
  const [row] = await db
    .insert(reminders)
    .values({
      title: input.title,
      remindAt: input.remindAt,
      level: onDevice ? input.level : "notification",
      status: onDevice ? "on_device" : "scheduled",
    })
    .returning();
  return row!;
}

export async function listUpcomingReminders(): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(and(inArray(reminders.status, ["scheduled", "on_device"]), gte(reminders.remindAt, new Date())))
    .orderBy(asc(reminders.remindAt));
}

export async function listRemindersBetween(from: Date, to: Date): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(
      and(
        inArray(reminders.status, ["scheduled", "on_device", "sent"]),
        gte(reminders.remindAt, from),
        lte(reminders.remindAt, to),
      ),
    )
    .orderBy(asc(reminders.remindAt));
}

export async function getReminder(id: string): Promise<Reminder> {
  const row = await db.query.reminders.findFirst({ where: eq(reminders.id, id) });
  if (!row) throw new NotFoundError(`Aucun rappel avec l'identifiant ${id}.`);
  return row;
}

export async function cancelReminder(id: string): Promise<Reminder> {
  await getReminder(id);
  const [row] = await db
    .update(reminders)
    .set({ status: "cancelled" })
    .where(and(eq(reminders.id, id), inArray(reminders.status, ["scheduled", "on_device"])))
    .returning();
  if (!row) throw new Error("Ce rappel est déjà passé ou annulé.");
  return row;
}

/** Envoie les rappels arrivés à échéance. Appelé chaque minute par le planificateur. */
export async function sendDueReminders(): Promise<void> {
  if (!isNotifyConfigured()) return;
  const due = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.remindAt, new Date())));

  for (const reminder of due) {
    const late = Date.now() - reminder.remindAt.getTime() > LATE_MS;
    try {
      await sendNotification({
        title: late ? "Rappel en retard" : "Rappel",
        message: reminder.title,
        priority: 4,
        tags: ["bell"],
      });
      await db.update(reminders).set({ status: "sent", sentAt: new Date() }).where(eq(reminders.id, reminder.id));
    } catch (err) {
      const attempts = reminder.attempts + 1;
      console.error(`Rappel « ${reminder.title} » non envoyé (essai ${attempts}) :`, err);
      await db
        .update(reminders)
        .set({ attempts, ...(attempts >= MAX_ATTEMPTS && { status: "failed" as const }) })
        .where(eq(reminders.id, reminder.id));
    }
  }
}
