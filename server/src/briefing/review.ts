/** Bilan d'une période (une journée, une semaine) : fonctions pures, sans base ni horloge. */

export interface ReviewTask {
  id: string;
  title: string;
  status: "todo" | "done";
  durationMin: number;
  actualMin: number | null;
  completedAt: Date | null;
}

export interface ReviewBlock {
  taskId: string | null;
}

export interface Review {
  done: ReviewTask[];
  /** Tâches placées dans la période et toujours pas faites. */
  missed: ReviewTask[];
  /** Tâches faites dont on connaît le temps réel : estimé et réel cumulés. */
  timing: { count: number; plannedMin: number; actualMin: number } | null;
}

export function reviewPeriod(input: {
  from: Date;
  to: Date;
  tasks: ReviewTask[];
  /** Créneaux de tâches placés dans la période. */
  blocks: ReviewBlock[];
}): Review {
  const inRange = (d: Date | null) => d !== null && d >= input.from && d < input.to;
  const done = input.tasks
    .filter((t) => t.status === "done" && inRange(t.completedAt))
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());

  const planned = new Set(input.blocks.map((b) => b.taskId).filter((id): id is string => id !== null));
  const missed = input.tasks.filter((t) => t.status === "todo" && planned.has(t.id));

  const timed = done.filter((t) => t.actualMin !== null);
  const timing =
    timed.length === 0
      ? null
      : {
          count: timed.length,
          plannedMin: timed.reduce((sum, t) => sum + t.durationMin, 0),
          actualMin: timed.reduce((sum, t) => sum + t.actualMin!, 0),
        };
  return { done, missed, timing };
}

/** « 1 h 30 », « 45 min ». */
export function spokenDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Lignes de faits sur le bilan, données à Claude et utilisées par la version de secours. */
export function describeReview(label: string, review: Review): string[] {
  const lines = [`${label} :`];
  lines.push(
    review.done.length === 0
      ? "- aucune tâche terminée"
      : `- ${review.done.length} tâche(s) terminée(s) : ${review.done.map((t) => t.title).join(", ")}`,
  );
  if (review.missed.length > 0) {
    lines.push(`- prévues mais pas faites : ${review.missed.map((t) => t.title).join(", ")}`);
  }
  if (review.timing) {
    const { count, plannedMin, actualMin } = review.timing;
    const gap = actualMin - plannedMin;
    const verdict =
      Math.abs(gap) <= plannedMin * 0.1
        ? "estimations justes"
        : gap > 0
          ? `${spokenDuration(gap)} de plus que prévu`
          : `${spokenDuration(-gap)} de moins que prévu`;
    lines.push(
      `- temps connu pour ${count} tâche(s) : ${spokenDuration(plannedMin)} prévues, ${spokenDuration(actualMin)} réelles (${verdict})`,
    );
  }
  return lines;
}
