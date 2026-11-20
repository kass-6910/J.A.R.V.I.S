/** Règles du sport : quand placer une séance, et laquelle. Fonctions pures, testées à part. */

export interface SportWeek {
  target: number;
  /** Séances faites cette semaine (lundi → aujourd'hui), séance du jour comprise. */
  doneThisWeek: number;
  doneToday: boolean;
  didYesterday: boolean;
  /** Jours restants dans la semaine, aujourd'hui compris (lundi = 7, dimanche = 1). */
  daysLeft: number;
}

/**
 * Faut-il placer une séance aujourd'hui ? Jamais deux jours de suite si on peut l'éviter,
 * mais l'objectif de la semaine passe avant le jour de repos quand les jours manquent.
 */
export function shouldScheduleSport(w: SportWeek): boolean {
  if (w.doneToday) return false;
  const remaining = w.target - w.doneThisWeek;
  if (remaining <= 0) return false;
  if (remaining >= w.daysLeft) return true;
  return !w.didYesterday;
}

/** Séance adaptée à la fatigue : nuit courte, séance plus légère. */
export function sessionFor(sleepMin: number | null, baseMin: number): { title: string; durationMin: number } {
  if (sleepMin !== null && sleepMin < 6 * 60) {
    return { title: "Séance légère (nuit courte)", durationMin: Math.max(20, Math.round(baseMin * 0.6)) };
  }
  return { title: "Séance de sport", durationMin: baseMin };
}
