import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import {
  adminDeadlines,
  careItems,
  contacts,
  routines,
  scheduleBlocks,
  supplementIntakes,
  supplements,
  tasks,
} from "../db/schema.js";
import {
  addDays,
  ageAt,
  contactOverdueDays,
  daysBetween,
  isCareDue,
  nextBirthday,
  nextCareDate,
  SUPPLEMENT_NUDGE_MS,
  supplementTime,
  type SupplementMoment,
} from "../life/rules.js";
import { actionUrl } from "../lib/signing.js";
import { atTime, now, zone } from "../lib/time.js";
import { getValue, setValue } from "./kv.js";
import { addShoppingItem, getShoppingItem } from "./shopping.js";
import { createTask, getTask, NotFoundError } from "./tasks.js";

const iso = (d: DateTime) => d.toISODate()!;

/** Notification envoyée une seule fois pour une clé donnée (la clé contient le jour). */
async function notifyOnce(key: string, n: Parameters<typeof sendNotification>[0]): Promise<void> {
  if (!isNotifyConfigured() || (await getValue(`notified:${key}`))) return;
  await sendNotification(n);
  await setValue(`notified:${key}`, new Date().toISOString());
}

// --- Soins perso --------------------------------------------------------------------

export type CareItem = typeof careItems.$inferSelect;

export async function addCareItem(input: {
  name: string;
  kind: CareItem["kind"];
  everyDays: number;
  durationMin?: number;
  lastDoneOn?: string;
}): Promise<CareItem> {
  const [row] = await db.insert(careItems).values(input).returning();
  return row!;
}

export async function listCareItems(): Promise<(CareItem & { nextOn: string })[]> {
  const today = iso(now());
  const rows = await db.select().from(careItems).orderBy(asc(careItems.name));
  return rows
    .map((r) => ({ ...r, nextOn: nextCareDate(r.lastDoneOn, r.everyDays, today) }))
    .sort((a, b) => a.nextOn.localeCompare(b.nextOn));
}

export async function markCareDone(id: string, on: string = iso(now())): Promise<CareItem> {
  const [row] = await db
    .update(careItems)
    .set({ lastDoneOn: on, pendingTaskId: null, pendingShoppingId: null })
    .where(eq(careItems.id, id))
    .returning();
  if (!row) throw new NotFoundError("Soin introuvable.");
  return row;
}

export async function removeCareItem(id: string): Promise<void> {
  await db.delete(careItems).where(eq(careItems.id, id));
}

/**
 * Soins arrivés à échéance dans la semaine : un rendez-vous devient une tâche (placée dans un
 * créneau libre), un produit part sur la liste de courses. Quand la tâche est faite ou le
 * produit acheté, le soin est noté comme fait.
 */
async function runCare(): Promise<void> {
  const today = now();
  for (const item of await db.select().from(careItems)) {
    if (item.pendingTaskId) {
      const task = await getTask(item.pendingTaskId).catch(() => null);
      if (!task) await db.update(careItems).set({ pendingTaskId: null }).where(eq(careItems.id, item.id));
      else if (task.status === "done") {
        await markCareDone(item.id, iso(DateTime.fromJSDate(task.completedAt ?? new Date(), { zone })));
      }
      continue;
    }
    if (item.pendingShoppingId) {
      const bought = await getShoppingItem(item.pendingShoppingId);
      if (!bought) await db.update(careItems).set({ pendingShoppingId: null }).where(eq(careItems.id, item.id));
      else if (bought.checkedAt) await markCareDone(item.id, iso(DateTime.fromJSDate(bought.checkedAt, { zone })));
      continue;
    }
    if (!isCareDue(item.lastDoneOn, item.everyDays, iso(today))) continue;

    const due = nextCareDate(item.lastDoneOn, item.everyDays, iso(today));
    if (item.kind === "produit") {
      const added = await addShoppingItem({ name: item.name, source: "soins", refType: "care", refId: item.id });
      await db.update(careItems).set({ pendingShoppingId: added.id }).where(eq(careItems.id, item.id));
    } else {
      // Échéance au plus tôt dans deux jours, pour laisser le temps de prendre rendez-vous.
      const deadline = DateTime.fromISO(due < addDays(iso(today), 2) ? addDays(iso(today), 2) : due, { zone }).set({ hour: 20 });
      const task = await createTask({
        title: item.name,
        durationMin: item.durationMin,
        deadline: deadline.toJSDate(),
        spaces: ["vie-perso"],
      });
      await db.update(careItems).set({ pendingTaskId: task.id }).where(eq(careItems.id, item.id));
    }
  }
}

// --- Compléments --------------------------------------------------------------------

export type Supplement = typeof supplements.$inferSelect;

export async function addSupplement(input: {
  name: string;
  moment: SupplementMoment;
  withMeal?: boolean;
  stockDoses?: number | null;
  lowAt?: number;
}): Promise<Supplement> {
  const [row] = await db.insert(supplements).values(input).returning();
  return row!;
}

export async function removeSupplement(id: string): Promise<void> {
  await db.delete(supplements).where(eq(supplements.id, id));
}

function mealDefaults(): Record<"matin" | "midi" | "soir", string> {
  const out = { matin: "08:00", midi: "12:30", soir: "19:30" };
  for (const pair of config.MEAL_TIMES.split(",")) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    if ((k === "matin" || k === "midi" || k === "soir") && v && /^\d{2}:\d{2}$/.test(v)) out[k] = v;
  }
  return out;
}

/** Heures de rappel du jour, calées sur les repas et la séance placés dans le planning. */
async function supplementSchedule(day: DateTime): Promise<{ supplement: Supplement; at: number }[]> {
  const blocks = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.day, iso(day)));
  const meals: Partial<Record<"matin" | "midi" | "soir", number>> = {};
  for (const b of blocks.filter((b) => b.kind === "meal")) {
    const hour = DateTime.fromJSDate(b.startsAt, { zone }).hour;
    meals[hour < 11 ? "matin" : hour < 16 ? "midi" : "soir"] = b.startsAt.getTime();
  }
  const sportBlock = blocks.find((b) => b.kind === "sport");
  const sport = sportBlock ? { start: sportBlock.startsAt.getTime(), end: sportBlock.endsAt.getTime() } : null;
  const defaults = mealDefaults();
  const defaultMs = {
    matin: atTime(day, defaults.matin).toMillis(),
    midi: atTime(day, defaults.midi).toMillis(),
    soir: atTime(day, defaults.soir).toMillis(),
  };
  const out: { supplement: Supplement; at: number }[] = [];
  for (const supplement of await db.select().from(supplements)) {
    const at = supplementTime(supplement.moment, { meals, sport }, defaultMs);
    if (at !== null) out.push({ supplement, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface TodaySupplement {
  supplement: Supplement;
  at: string;
  intakeId: string | null;
  takenAt: Date | null;
}

export async function todaySupplements(): Promise<TodaySupplement[]> {
  const today = now().startOf("day");
  const schedule = await supplementSchedule(today);
  const intakes = await db.select().from(supplementIntakes).where(eq(supplementIntakes.day, iso(today)));
  return schedule.map(({ supplement, at }) => {
    const intake = intakes.find((i) => i.supplementId === supplement.id);
    return {
      supplement,
      at: new Date(at).toISOString(),
      intakeId: intake?.id ?? null,
      takenAt: intake?.takenAt ?? null,
    };
  });
}

/** Complément pris : la prise est notée, le stock baisse et part sur la liste de courses s'il est bas. */
export async function markSupplementTaken(supplementId: string): Promise<Supplement> {
  const day = iso(now());
  const [intake] = await db
    .insert(supplementIntakes)
    .values({ supplementId, day, takenAt: new Date() })
    .onConflictDoUpdate({ target: [supplementIntakes.supplementId, supplementIntakes.day], set: { takenAt: new Date() } })
    .returning();
  const supplement = await db.query.supplements.findFirst({ where: eq(supplements.id, intake!.supplementId) });
  if (!supplement) throw new NotFoundError("Complément introuvable.");
  if (supplement.stockDoses === null) return supplement;
  const stock = Math.max(0, supplement.stockDoses - 1);
  await db.update(supplements).set({ stockDoses: stock }).where(eq(supplements.id, supplement.id));
  if (stock <= supplement.lowAt) {
    await addShoppingItem({ name: supplement.name, source: "complement", refType: "supplement", refId: supplement.id });
  }
  return { ...supplement, stockDoses: stock };
}

export async function markIntakeTaken(intakeId: string): Promise<void> {
  const intake = await db.query.supplementIntakes.findFirst({ where: eq(supplementIntakes.id, intakeId) });
  if (!intake) throw new NotFoundError("Prise introuvable.");
  if (!intake.takenAt) await markSupplementTaken(intake.supplementId);
}

export async function restockSupplement(id: string, doses: number): Promise<void> {
  await db.update(supplements).set({ stockDoses: doses }).where(eq(supplements.id, id));
}

/** Rappel à l'heure, puis un rappel discret 45 minutes plus tard sans confirmation. */
async function runSupplements(): Promise<void> {
  if (!isNotifyConfigured()) return;
  const today = now().startOf("day");
  const nowMs = Date.now();
  for (const { supplement, at } of await supplementSchedule(today)) {
    if (at > nowMs || nowMs - at > 6 * 3600_000) continue;
    const [intake] = await db
      .insert(supplementIntakes)
      .values({ supplementId: supplement.id, day: iso(today) })
      .onConflictDoUpdate({ target: [supplementIntakes.supplementId, supplementIntakes.day], set: { day: iso(today) } })
      .returning();
    if (intake!.takenAt) continue;
    const button = actionUrl(`/api/public/intakes/${intake!.id}/taken`);
    const actions = button ? [{ label: "Pris", url: button }] : undefined;
    const meal = supplement.withMeal ? " avec le repas" : "";
    if (!intake!.remindedAt) {
      await sendNotification({ title: supplement.name, message: `À prendre maintenant${meal}.`, priority: 3, tags: ["pill"], actions });
      await db.update(supplementIntakes).set({ remindedAt: new Date() }).where(eq(supplementIntakes.id, intake!.id));
    } else if (!intake!.nudgedAt && nowMs - intake!.remindedAt.getTime() >= SUPPLEMENT_NUDGE_MS) {
      await sendNotification({ title: supplement.name, message: "Pas encore pris ?", priority: 2, tags: ["pill"], actions });
      await db.update(supplementIntakes).set({ nudgedAt: new Date() }).where(eq(supplementIntakes.id, intake!.id));
    }
  }
}

// --- Administratif -------------------------------------------------------------------

export type AdminDeadline = typeof adminDeadlines.$inferSelect;

export async function addAdminDeadline(input: { title: string; dueOn: string; remindDays?: number; notes?: string }): Promise<AdminDeadline> {
  const [row] = await db.insert(adminDeadlines).values(input).returning();
  return row!;
}

export async function listAdminDeadlines(includeDone = false): Promise<AdminDeadline[]> {
  return db
    .select()
    .from(adminDeadlines)
    .where(includeDone ? undefined : isNull(adminDeadlines.doneAt))
    .orderBy(asc(adminDeadlines.dueOn));
}

export async function markAdminDone(id: string): Promise<AdminDeadline> {
  const [row] = await db.update(adminDeadlines).set({ doneAt: new Date() }).where(eq(adminDeadlines.id, id)).returning();
  if (!row) throw new NotFoundError("Échéance introuvable.");
  return row;
}

export async function removeAdminDeadline(id: string): Promise<void> {
  await db.delete(adminDeadlines).where(eq(adminDeadlines.id, id));
}

/** Rappel « remindDays » jours avant, la veille et le jour même (le matin). */
async function runAdmin(): Promise<void> {
  const current = now();
  if (current.hour < 8) return;
  const today = iso(current);
  const open = await db
    .select()
    .from(adminDeadlines)
    .where(and(isNull(adminDeadlines.doneAt), lte(adminDeadlines.dueOn, addDays(today, 60))));
  for (const d of open) {
    const left = daysBetween(today, d.dueOn);
    if (left !== d.remindDays && left !== 1 && left !== 0 && left >= 0) continue;
    const when = left < 0 ? `en retard de ${-left} jour(s)` : left === 0 ? "aujourd'hui" : left === 1 ? "demain" : `dans ${left} jours`;
    if (left < 0 && current.weekday !== 1) continue; // En retard : rappel une fois par semaine, le lundi.
    await notifyOnce(`admin:${d.id}:${today}`, {
      title: "Administratif",
      message: `${d.title} : ${when} (${DateTime.fromISO(d.dueOn).setLocale("fr").toFormat("d LLLL")}).`,
      priority: left <= 1 ? 4 : 3,
      tags: ["page_facing_up"],
    });
  }
}

// --- Proches -------------------------------------------------------------------------

export type Contact = typeof contacts.$inferSelect;

export async function addContact(input: {
  name: string;
  relation?: string;
  birthday?: string;
  birthYear?: number;
  callEveryDays?: number;
}): Promise<Contact> {
  const [row] = await db.insert(contacts).values(input).returning();
  return row!;
}

export async function listContacts(): Promise<Contact[]> {
  return db.select().from(contacts).orderBy(asc(contacts.name));
}

export async function markContacted(id: string, on: string = iso(now())): Promise<Contact> {
  const [row] = await db.update(contacts).set({ lastContactOn: on }).where(eq(contacts.id, id)).returning();
  if (!row) throw new NotFoundError("Proche introuvable.");
  return row;
}

export async function removeContact(id: string): Promise<void> {
  await db.delete(contacts).where(eq(contacts.id, id));
}

export interface ContactNews {
  birthdays: { contact: Contact; on: string; age: number | null; inDays: number }[];
  toCall: { contact: Contact; lateDays: number }[];
}

/** Anniversaires dans les « horizon » jours et proches pas appelés depuis trop longtemps. */
export async function contactNews(horizon = 7): Promise<ContactNews> {
  const today = iso(now());
  const all = await listContacts();
  const birthdays = all
    .filter((c) => c.birthday)
    .map((c) => {
      const on = nextBirthday(c.birthday!, today);
      return { contact: c, on, age: ageAt(c.birthYear, on), inDays: daysBetween(today, on) };
    })
    .filter((b) => b.inDays <= horizon)
    .sort((a, b) => a.inDays - b.inDays);
  const toCall = all
    .map((c) => ({ contact: c, lateDays: contactOverdueDays(c.lastContactOn, c.callEveryDays, today, iso(DateTime.fromJSDate(c.createdAt, { zone }))) }))
    .filter((c): c is { contact: Contact; lateDays: number } => c.lateDays !== null)
    .sort((a, b) => b.lateDays - a.lateDays);
  return { birthdays, toCall };
}

async function runContacts(): Promise<void> {
  const current = now();
  if (current.hour < 9) return;
  const today = iso(current);
  const { birthdays, toCall } = await contactNews(1);
  for (const b of birthdays) {
    const age = b.age ? ` (${b.age} ans)` : "";
    await notifyOnce(`birthday:${b.contact.id}:${today}`, {
      title: b.inDays === 0 ? "Anniversaire aujourd'hui" : "Anniversaire demain",
      message: `${b.contact.name}${age}.`,
      priority: b.inDays === 0 ? 4 : 3,
      tags: ["birthday"],
    });
  }
  // Un petit rappel par semaine (le samedi) pour le proche le plus en retard.
  if (current.weekday === 6 && toCall[0]) {
    await notifyOnce(`call:${today}`, {
      title: "Proches",
      message: `Ça fait un moment que tu n'as pas appelé ${toCall[0].contact.name}.`,
      priority: 2,
      tags: ["telephone_receiver"],
    });
  }
}

// --- Routines --------------------------------------------------------------------

export type Routine = typeof routines.$inferSelect;

export async function setRoutine(moment: Routine["moment"], time: string, items: string): Promise<Routine> {
  const [row] = await db
    .insert(routines)
    .values({ moment, time, items })
    .onConflictDoUpdate({ target: routines.moment, set: { time, items } })
    .returning();
  return row!;
}

export async function listRoutines(): Promise<Routine[]> {
  return db.select().from(routines);
}

export async function removeRoutine(moment: Routine["moment"]): Promise<void> {
  await db.delete(routines).where(eq(routines.moment, moment));
}

async function runRoutines(): Promise<void> {
  const current = now();
  for (const r of await listRoutines()) {
    const at = atTime(current.startOf("day"), r.time);
    if (current < at || current.diff(at, "minutes").minutes > 60) continue;
    await notifyOnce(`routine:${r.moment}:${iso(current)}`, {
      title: r.moment === "matin" ? "Routine du matin" : "Routine du soir",
      message: r.items,
      priority: 2,
      tags: [r.moment === "matin" ? "sunny" : "zzz"],
    });
  }
}

// --- Tâches planifiées et briefing -------------------------------------------------------

/** Soins, échéances administratives, proches et routines : idempotent, lancé à chaque tour. */
export async function runDailyLife(): Promise<void> {
  for (const [name, job] of [
    ["soins", runCare],
    ["administratif", runAdmin],
    ["proches", runContacts],
    ["routines", runRoutines],
  ] as const) {
    try {
      await job();
    } catch (err) {
      console.error(`Vie quotidienne (${name}) en échec :`, err);
    }
  }
}

export { runSupplements };

/** Faits pour le briefing : anniversaires, papiers, soins de la semaine, compléments, proches. */
export async function lifeFacts(kind: "morning" | "evening"): Promise<string[]> {
  const today = iso(now());
  const [news, admin, care, open] = await Promise.all([
    contactNews(kind === "morning" ? 7 : 1),
    listAdminDeadlines(),
    listCareItems(),
    db.select({ id: tasks.id }).from(tasks).where(eq(tasks.status, "todo")),
  ]);
  const openIds = new Set(open.map((t) => t.id));
  const lines: string[] = [];
  for (const b of news.birthdays) {
    const when = b.inDays === 0 ? "aujourd'hui" : b.inDays === 1 ? "demain" : `dans ${b.inDays} jours`;
    lines.push(`- anniversaire de ${b.contact.name}${b.contact.relation ? ` (${b.contact.relation})` : ""} ${when}${b.age ? `, ${b.age} ans` : ""}`);
  }
  for (const d of admin.filter((a) => daysBetween(today, a.dueOn) <= 7)) {
    const left = daysBetween(today, d.dueOn);
    lines.push(`- administratif : ${d.title}, ${left < 0 ? `en retard de ${-left} jour(s)` : left === 0 ? "aujourd'hui" : `dans ${left} jour(s)`}`);
  }
  for (const c of care.filter((c) => c.pendingTaskId && openIds.has(c.pendingTaskId))) {
    lines.push(`- à prévoir cette semaine : ${c.name}`);
  }
  if (kind === "morning" && news.toCall[0]) {
    lines.push(`- proche à appeler : ${news.toCall[0].contact.name} (pas d'appel depuis longtemps)`);
  }
  if (kind === "morning") {
    const pills = await todaySupplements();
    if (pills.length > 0) {
      lines.push(`- compléments du jour : ${pills.map((p) => `${p.supplement.name} (${p.supplement.moment.replace("_", " ")})`).join(", ")}`);
    }
  }
  return lines.length > 0 ? ["Vie perso :", ...lines] : [];
}
