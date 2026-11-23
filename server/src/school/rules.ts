/** École : examens et révisions. Fonctions pures, testées à part. */

const EXAM = /\b(examens?|partiels?|contr[ôo]les?|ds|soutenances?|oraux|oral|qcm noté|rattrapages?)\b/i;

/** Un événement de l'agenda est-il un examen ? */
export function isExamTitle(title: string): boolean {
  return EXAM.test(title);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Jours de révision avant un examen, espacés (veille, puis J-2, J-4, J-6…), jamais dans le passé.
 * S'il ne reste pas assez de jours, les séances se resserrent sur les jours disponibles.
 */
export function revisionDays(examDay: string, today: string, sessions: number): string[] {
  if (examDay <= today) return [];
  const spaced = [1, 2, 4, 6, 8, 10].slice(0, sessions).map((n) => addDays(examDay, -n));
  const future = spaced.filter((d) => d >= today);
  const missing = sessions - future.length;
  if (missing <= 0) return future.sort();
  // Pas assez de jours espacés : on complète avec les jours libres restants avant l'examen.
  const all: string[] = [];
  for (let d = today; d < examDay; d = addDays(d, 1)) all.push(d);
  const extra = all.filter((d) => !future.includes(d)).slice(-missing);
  return [...new Set([...future, ...extra])].sort();
}

/** Rappels d'examen : 3 jours avant, la veille et le jour même. */
export function examReminderDue(examDay: string, today: string): "j-3" | "j-1" | "jour" | null {
  if (addDays(today, 3) === examDay) return "j-3";
  if (addDays(today, 1) === examDay) return "j-1";
  if (today === examDay) return "jour";
  return null;
}

const STOP = new Set(["examen", "examens", "partiel", "partiels", "controle", "contrôle", "final", "finale", "session", "epreuve", "épreuve", "devoir", "surveille", "surveillé"]);

function keywords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

/**
 * Deux examens le même jour sont le même s'ils partagent un mot significatif
 * (« Examen de gestion financière » et « Partiel gestion financière »).
 */
export function sameExam(a: { title: string; day: string }, b: { title: string; day: string }): boolean {
  if (a.day !== b.day) return false;
  const ka = keywords(a.title);
  return [...keywords(b.title)].some((w) => ka.has(w));
}
