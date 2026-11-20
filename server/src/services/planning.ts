import { and, eq, gte, inArray } from "drizzle-orm";
import type { DateTime } from "luxon";
import { config } from "../config.js";
import { isCalendarConfigured, listEvents, type CalendarEvent } from "../connectors/google/calendar.js";
import { db } from "../db/client.js";
import { scheduleBlocks } from "../db/schema.js";
import { atTime, now } from "../lib/time.js";
import { planDay, type Interval } from "../planner/schedule.js";
import { sportSessionFor, sportWeek } from "./health.js";
import { ensurePrayerBlocks } from "./prayer.js";
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

/** Rendez-vous de l'agenda (hors journées entières) comme intervalles occupés. */
function eventIntervals(events: CalendarEvent[]): Interval[] {
  return events.filter((e) => !e.allDay).map((e) => ({ start: e.start.getTime(), end: e.end.getTime() }));
}

const toInterval = (b: { startsAt: Date; endsAt: Date }): Interval => ({
  start: b.startsAt.getTime(),
  end: b.endsAt.getTime(),
});

/**
 * Place la séance de sport du jour, de préférence à partir de SPORT_PREFERRED_START,
 * sinon dans le premier créneau libre de la journée. Null si rien ne rentre.
 */
function placeSport(
  day: DateTime,
  session: { title: string; durationMin: number },
  busy: Interval[],
  nowMs: number,
): Interval | null {
  const end = atTime(day, config.PLANNING_DAY_END).toMillis();
  const dayStart = atTime(day, config.PLANNING_DAY_START).toMillis();
  const preferred = Math.max(dayStart, atTime(day, config.SPORT_PREFERRED_START).toMillis());
  const pseudo = {
    id: "sport",
    durationMin: session.durationMin,
    priority: "high" as const,
    deadline: null,
    beforeTaskId: null,
    createdAt: new Date(0),
  };
  for (const start of [preferred, dayStart]) {
    const { placed } = planDay({ window: { start, end }, now: nowMs, busy, tasks: [pseudo] });
    if (placed[0]) return { start: placed[0].start, end: placed[0].end };
  }
  return null;
}

/** Créneaux que Jarvis déplace librement : les tâches et la séance de sport. */
const isMovable = (b: { kind: string }) => b.kind === "task" || b.kind === "sport";

/**
 * Recale la journée : la séance de sport puis les tâches à faire sont replacées dans
 * les créneaux libres à partir de maintenant, autour des rendez-vous et des prières.
 * Les créneaux déjà commencés restent en place.
 */
export async function replanToday(): Promise<DayPlan> {
  const current = now();
  const day = current.startOf("day");
  const iso = day.toISODate()!;
  const nowMs = current.toMillis();
  // Les prières sont placées d'abord : ce sont des créneaux protégés.
  const [{ events, calendar }, open, session, week] = await Promise.all([
    loadEvents(day),
    listOpenTasks(),
    sportSessionFor(day),
    sportWeek(day),
    ensurePrayerBlocks(day),
  ]);

  const existing = await loadBlocks(iso);
  const inProgress = existing.filter(
    (b) =>
      isMovable(b) &&
      b.startsAt.getTime() <= nowMs &&
      b.endsAt.getTime() > nowMs &&
      (b.kind === "sport" ? !week.doneToday : open.some((t) => t.id === b.taskId)),
  );
  const keptIds = new Set(inProgress.map((b) => b.taskId));
  const fixed = existing.filter((b) => !isMovable(b));
  const busy = [...eventIntervals(events), ...[...fixed, ...inProgress].map(toInterval)];

  const sportInProgress = inProgress.some((b) => b.kind === "sport");
  const sport = session && !sportInProgress ? placeSport(day, session, busy, nowMs) : null;
  if (sport) busy.push(sport);

  const { placed, unplaced } = planDay({
    window: {
      start: atTime(day, config.PLANNING_DAY_START).toMillis(),
      end: atTime(day, config.PLANNING_DAY_END).toMillis(),
    },
    now: nowMs,
    busy,
    tasks: open.filter((t) => !keptIds.has(t.id)),
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.day, iso),
          inArray(scheduleBlocks.kind, ["task", "sport"]),
          gte(scheduleBlocks.startsAt, current.toJSDate()),
        ),
      );
    const rows: (typeof scheduleBlocks.$inferInsert)[] = placed.map((p) => ({
      day: iso,
      kind: "task" as const,
      taskId: p.task.id,
      title: p.task.title,
      startsAt: new Date(p.start),
      endsAt: new Date(p.end),
    }));
    if (sport && session) {
      rows.push({
        day: iso,
        kind: "sport",
        taskId: null,
        title: session.title,
        startsAt: new Date(sport.start),
        endsAt: new Date(sport.end),
      });
    }
    if (rows.length > 0) await tx.insert(scheduleBlocks).values(rows);
  });

  return { day: iso, events, blocks: await loadBlocks(iso), unplaced, calendar };
}

/**
 * Aperçu d'un jour à venir, sans rien enregistrer : où tomberaient les tâches
 * à faire si la journée commençait maintenant. Sert au bilan du soir.
 */
export async function previewDay(day: DateTime): Promise<DayPlan> {
  const iso = day.toISODate()!;
  const [{ events, calendar }, open] = await Promise.all([loadEvents(day), listOpenTasks(), ensurePrayerBlocks(day)]);
  const fixed = (await loadBlocks(iso)).filter((b) => !isMovable(b));
  const session = await sportSessionFor(day);
  const window = {
    start: atTime(day, config.PLANNING_DAY_START).toMillis(),
    end: atTime(day, config.PLANNING_DAY_END).toMillis(),
  };
  const busy = [...eventIntervals(events), ...fixed.map(toInterval)];
  const sport = session ? placeSport(day, session, busy, window.start) : null;
  if (sport) busy.push(sport);
  const { placed, unplaced } = planDay({ window, now: window.start, busy, tasks: open });
  const blocks = placed.map((p) => ({
    id: `apercu-${p.task.id}`,
    day: iso,
    kind: "task" as const,
    taskId: p.task.id,
    title: p.task.title,
    startsAt: new Date(p.start),
    endsAt: new Date(p.end),
    protected: false,
  }));
  return {
    day: iso,
    events,
    blocks: [
      ...fixed,
      ...blocks,
      ...(sport && session
        ? [
            {
              id: "apercu-sport",
              day: iso,
              kind: "sport" as const,
              taskId: null,
              title: session.title,
              startsAt: new Date(sport.start),
              endsAt: new Date(sport.end),
              protected: false,
            },
          ]
        : []),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    unplaced,
    calendar,
  };
}
