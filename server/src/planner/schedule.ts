import type { Priority } from "../db/schema.js";

/** Intervalle en millisecondes epoch, fin exclue. */
export interface Interval {
  start: number;
  end: number;
}

export interface PlannableTask {
  id: string;
  durationMin: number;
  priority: Priority;
  deadline: Date | null;
  beforeTaskId: string | null;
  createdAt: Date;
}

const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
const MINUTE = 60_000;

/**
 * Ordre de traitement : priorité, puis échéance la plus proche, puis ancienneté.
 * Les consignes explicites (« ça passe avant le rendu ») sont appliquées par-dessus.
 */
export function orderTasks<T extends PlannableTask>(tasks: T[]): T[] {
  const ordered = [...tasks].sort(
    (a, b) =>
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
      (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // Nombre de passes borné : une boucle de consignes contradictoires ne bloque pas le tri.
  for (let pass = 0; pass < ordered.length; pass++) {
    let moved = false;
    for (const task of [...ordered]) {
      if (!task.beforeTaskId) continue;
      const from = ordered.indexOf(task);
      const target = ordered.findIndex((t) => t.id === task.beforeTaskId);
      if (target === -1 || from < target) continue;
      ordered.splice(from, 1);
      ordered.splice(target, 0, task);
      moved = true;
    }
    if (!moved) break;
  }
  return ordered;
}

function freeGaps(window: Interval, busy: Interval[]): Interval[] {
  const sorted = busy
    .filter((b) => b.end > window.start && b.start < window.end)
    .sort((a, b) => a.start - b.start);
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}

export interface PlanInput<T extends PlannableTask> {
  /** Plage de la journée où Jarvis a le droit de placer des tâches. */
  window: Interval;
  now: number;
  /** Rendez-vous de l'agenda et créneaux protégés. */
  busy: Interval[];
  /** Tâches déjà triées (voir orderTasks). */
  tasks: T[];
  /** Pause laissée après chaque tâche. */
  bufferMin?: number;
}

export interface PlanResult<T> {
  placed: { task: T; start: number; end: number }[];
  unplaced: T[];
}

/** Place chaque tâche, dans l'ordre, dans le premier créneau libre assez long. */
export function planDay<T extends PlannableTask>(input: PlanInput<T>): PlanResult<T> {
  const step = 5 * MINUTE;
  const buffer = (input.bufferMin ?? 5) * MINUTE;
  const start = Math.max(input.window.start, Math.ceil(input.now / step) * step);
  const gaps = freeGaps({ start, end: input.window.end }, input.busy);

  const placed: PlanResult<T>["placed"] = [];
  const unplaced: T[] = [];
  for (const task of input.tasks) {
    const length = task.durationMin * MINUTE;
    const gap = gaps.find((g) => g.end - g.start >= length);
    if (!gap) {
      unplaced.push(task);
      continue;
    }
    placed.push({ task, start: gap.start, end: gap.start + length });
    gap.start += length + buffer;
  }
  placed.sort((a, b) => a.start - b.start);
  return { placed, unplaced };
}
