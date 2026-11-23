/** Règles de la vie quotidienne : fonctions pures, sur des dates AAAA-MM-JJ, testées à part. */

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Prochaine échéance d'un soin récurrent : dernière fois + fréquence ; aujourd'hui s'il n'a jamais été fait. */
export function nextCareDate(lastDone: string | null, everyDays: number, today: string): string {
  return lastDone ? addDays(lastDone, everyDays) : today;
}

/** Un soin est à prévoir dès que son échéance tombe dans la semaine qui vient (ou est dépassée). */
export function isCareDue(lastDone: string | null, everyDays: number, today: string, horizonDays = 7): boolean {
  return daysBetween(today, nextCareDate(lastDone, everyDays, today)) <= horizonDays;
}

/** Prochain anniversaire (« MM-JJ ») à partir d'aujourd'hui ; un 29 février tombe le 28 les autres années. */
export function nextBirthday(monthDay: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const at = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${monthDay === "02-29" && !leap ? "02-28" : monthDay}`;
  };
  return at(year) >= today ? at(year) : at(year + 1);
}

/** Âge atteint à l'anniversaire donné, si l'année de naissance est connue. */
export function ageAt(birthYear: number | null, birthday: string): number | null {
  return birthYear ? Number(birthday.slice(0, 4)) - birthYear : null;
}

/** Proche à rappeler : la fréquence voulue est dépassée (ou jamais appelé depuis l'ajout). */
export function contactOverdueDays(lastContact: string | null, everyDays: number | null, today: string, added: string): number | null {
  if (!everyDays) return null;
  const since = daysBetween(lastContact ?? added, today);
  return since > everyDays ? since - everyDays : null;
}

export const SUPPLEMENT_MOMENTS = ["matin", "midi", "soir", "avant_sport", "apres_sport"] as const;
export type SupplementMoment = (typeof SUPPLEMENT_MOMENTS)[number];

/**
 * Heure du rappel d'un complément, calée sur le planning du jour :
 * repas pour matin, midi et soir s'il est placé, sinon l'heure par défaut ;
 * avant ou après la séance de sport (rien un jour sans séance).
 */
export function supplementTime(
  moment: SupplementMoment,
  day: { meals: Partial<Record<"matin" | "midi" | "soir", number>>; sport: { start: number; end: number } | null },
  defaults: Record<"matin" | "midi" | "soir", number>,
): number | null {
  if (moment === "avant_sport") return day.sport ? day.sport.start - 30 * 60_000 : null;
  if (moment === "apres_sport") return day.sport ? day.sport.end : null;
  return day.meals[moment] ?? defaults[moment];
}

/** Rappel discret si le complément n'est pas confirmé « pris » 45 minutes après le premier. */
export const SUPPLEMENT_NUDGE_MS = 45 * 60_000;
