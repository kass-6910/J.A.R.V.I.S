import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { formatTime, now } from "../lib/time.js";
import { findBriefing, generateBriefing, notifyBriefing } from "../services/briefing.js";
import { checkMailboxes } from "../services/mails.js";
import { checkManageo } from "../services/manageo.js";
import { runDailyLife, runSupplements } from "../services/life.js";
import { ensureMealPlan } from "../services/meals.js";
import { notifyUpcomingPrayers, prefetchPrayerData } from "../services/prayer.js";
import { sendDueReminders } from "../services/reminders.js";
import { dueRoutines, isIntervalDue } from "./routines.js";

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

const MAIL_INTERVAL_MS = 15 * 60_000;

interface Job {
  name: string;
  run: () => Promise<void>;
  /** Intervalle minimal entre deux passages ; à chaque tour sinon. */
  everyMs?: number;
}

const JOBS: Job[] = [
  { name: "rappels", run: sendDueReminders },
  { name: "échéances", run: alertDeadlines },
  { name: "briefing et bilan", run: runRoutines },
  { name: "mails", run: async () => void (await checkMailboxes()), everyMs: MAIL_INTERVAL_MS },
  { name: "Manageo : stocks, ventes, équipe", run: checkManageo, everyMs: 15 * 60_000 },
  { name: "prière : horaires et rappel du jour", run: prefetchPrayerData, everyMs: 60 * 60_000 },
  { name: "prière : notifications", run: notifyUpcomingPrayers },
  { name: "vie quotidienne", run: runDailyLife, everyMs: 5 * 60_000 },
  { name: "menus de la semaine", run: ensureMealPlan, everyMs: 60 * 60_000 },
  { name: "compléments", run: runSupplements },
];

/**
 * Démarre le planificateur ; renvoie une fonction pour l'arrêter.
 * Chaque tâche tourne indépendamment : une tâche lente (tri des mails, rédaction du briefing)
 * ne retarde pas les rappels, et une tâche ne se chevauche jamais avec elle-même.
 */
export function startScheduler(): () => Promise<void> {
  const running = new Map<string, Promise<void>>();
  const lastRun = new Map<string, number>();

  const tick = () => {
    for (const job of JOBS) {
      if (running.has(job.name)) continue;
      if (job.everyMs && !isIntervalDue(lastRun.get(job.name) ?? null, Date.now(), job.everyMs)) continue;
      lastRun.set(job.name, Date.now());
      const promise = job
        .run()
        .catch((err) => console.error(`Tâche planifiée « ${job.name} » en échec :`, err))
        .finally(() => running.delete(job.name));
      running.set(job.name, promise);
    }
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return async () => {
    clearInterval(timer);
    await Promise.all(running.values());
  };
}
