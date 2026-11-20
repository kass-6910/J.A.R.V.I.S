import { and, eq, gte } from "drizzle-orm";
import type { DateTime } from "luxon";
import { config } from "../config.js";
import { isCalendarConfigured, listEvents, type CalendarEvent } from "../connectors/google/calendar.js";
import { db } from "../db/client.js";
import { scheduleBlocks } from "../db/schema.js";
import { atTime, now } from "../lib/time.js";
import { planDay } from "../planner/schedule.js";
import { listOpenTasks, type Task } from "./tasks.js";

export interface DayPlan {
  day: string;
  events: CalendarEvent[];
  blocks: (typeof scheduleBlocks.$inferSelect)[];
  /** Tâches qui ne rentrent pas aujourd'hui. Vide pour un autre jour que aujourd'hui. */
  unplaced: Task[];
  calendar: "connected" | "not_configured" | "error";
}

async function loadEvents(day: DateTime): Promise<Pick<DayPlan, "events" | "calendar">> {
  if (!isCalendarConfigured()) return { events: [], calendar: "not_configured" };
  try {
    const events = await listEvents(day.startOf("day").toJSDate(), day.endOf("day").toJSDate());
    return { events, calendar: "connected" };
  } catch (err) {
    // Un agenda injoignable ne doit pas empêcher de gérer les tâches ; l'état est remonté à l'interface.
    console.error("Lecture de Google Agenda impossible :", err);
    return { events: [], calendar: "error" };
  }
}

async function loadBlocks(day: string) {
  return db.query.scheduleBlocks.findMany({
    where: eq(scheduleBlocks.day, day),
    orderBy: (b, { asc }) => asc(b.startsAt),
  });
}

/** Planning d'un jour : rendez-vous de l'agenda et créneaux placés par Jarvis. */
export async function getDayPlan(day: DateTime): Promise<DayPlan> {
  const iso = day.toISODate()!;
  const [{ events, calendar }, blocks] = await Promise.all([loadEvents(day), loadBlocks(iso)]);
  return { day: iso, events, blocks, unplaced: [], calendar };
}

/**
 * Recale la journée : les tâches à faire sont replacées dans les créneaux libres
 * à partir de maintenant. Les créneaux déjà commencés restent en place.
 */
export async function replanToday(): Promise<DayPlan> {
  const current = now();
  const day = current.startOf("day");
  const iso = day.toISODate()!;
  const [{ events, calendar }, open] = await Promise.all([loadEvents(day), listOpenTasks()]);

  const existing = await loadBlocks(iso);
  const started = existing.filter((b) => b.kind === "task" && b.startsAt.getTime() <= current.toMillis());
  const startedOpen = started.filter(
    (b) => b.endsAt.getTime() > current.toMillis() && open.some((t) => t.id === b.taskId),
  );
  const keptIds = new Set(startedOpen.map((b) => b.taskId));
  const fixed = existing.filter((b) => b.kind !== "task");

  const { placed, unplaced } = planDay({
    window: {
      start: atTime(day, config.PLANNING_DAY_START).toMillis(),
      end: atTime(day, config.PLANNING_DAY_END).toMillis(),
    },
    now: current.toMillis(),
    busy: [
      ...events.filter((e) => !e.allDay).map((e) => ({ start: e.start.getTime(), end: e.end.getTime() })),
      ...[...fixed, ...startedOpen].map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
    ],
    tasks: open.filter((t) => !keptIds.has(t.id)),
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(scheduleBlocks)
      .where(
        and(eq(scheduleBlocks.day, iso), eq(scheduleBlocks.kind, "task"), gte(scheduleBlocks.startsAt, current.toJSDate())),
      );
    if (placed.length > 0) {
      await tx.insert(scheduleBlocks).values(
        placed.map((p) => ({
          day: iso,
          kind: "task" as const,
          taskId: p.task.id,
          title: p.task.title,
          startsAt: new Date(p.start),
          endsAt: new Date(p.end),
        })),
      );
    }
  });

  return { day: iso, events, blocks: await loadBlocks(iso), unplaced, calendar };
}
