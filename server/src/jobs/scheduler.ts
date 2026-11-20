import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { formatTime, now } from "../lib/time.js";
import { findBriefing, generateBriefing, notifyBriefing } from "../services/briefing.js";
import { sendDueReminders } from "../services/reminders.js";
import { dueRoutines } from "./routines.js";

const TICK_MS = 30_000;
/** Une tâche dont l'échéance tombe dans moins de deux heures déclenche une alerte, une seule fois. */
const DEADLINE_ALERT_MS = 2 * 60 * 60_000;

async function alertDeadlines(): Promise<void> {
  if (!isNotifyConfigured()) return;
  const soon = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "todo"),
        isNull(tasks.deadlineAlertedAt),
        gt(tasks.deadline, new Date()),
        lte(tasks.deadline, new Date(Date.now() + DEADLINE_ALERT_MS)),
      ),
    );
  for (const task of soon) {
    await sendNotification({
      title: "Échéance proche",
      message: `« ${task.title} » est à rendre à ${formatTime(task.deadline!)}.`,
      priority: 4,
      tags: ["hourglass"],
    });
    await db.update(tasks).set({ deadlineAlertedAt: new Date() }).where(eq(tasks.id, task.id));
  }
}

async function runRoutines(): Promise<void> {
  const current = now();
  const today = current.startOf("day");
  const [morning, evening] = await Promise.all([findBriefing("morning", today), findBriefing("evening", today)]);
  const due = dueRoutines({
    minutes: current.hour * 60 + current.minute,
    morningAt: config.BRIEFING_TIME,
    eveningAt: config.EVENING_TIME,
    morningDone: morning !== null,
    eveningDone: evening !== null,
  });
  for (const kind of due) {
    const briefing = await generateBriefing(kind, today);
    console.log(`Routine ${kind} rédigée (${briefing.source}).`);
    await notifyBriefing(briefing);
  }
}

/** Chaque étape est isolée : une panne de l'une n'empêche pas les autres. */
async function tick(): Promise<void> {
  for (const [name, job] of [
    ["rappels", sendDueReminders],
    ["échéances", alertDeadlines],
    ["briefing et bilan", runRoutines],
  ] as const) {
    try {
      await job();
    } catch (err) {
      console.error(`Tâche planifiée « ${name} » en échec :`, err);
    }
  }
}

/** Démarre le planificateur ; renvoie une fonction pour l'arrêter. */
export function startScheduler(): () => Promise<void> {
  let running: Promise<void> | null = null;
  const run = () => {
    // Un tour lent (rédaction du briefing) ne doit pas se chevaucher avec le suivant.
    if (running) return;
    running = tick().finally(() => {
      running = null;
    });
  };
  run();
  const timer = setInterval(run, TICK_MS);
  return async () => {
    clearInterval(timer);
    await running;
  };
}
