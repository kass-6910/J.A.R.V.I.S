/** Décide quelle routine quotidienne lancer : fonction pure, testée à part. */

export interface RoutineClock {
  /** Minutes écoulées depuis minuit, heure locale. */
  minutes: number;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Le briefing du matin ne part plus après midi : passé cette heure, il serait inutile. */
const MORNING_DEADLINE = 12 * 60;

export function dueRoutines(input: {
  minutes: number;
  morningAt: string;
  eveningAt: string;
  morningDone: boolean;
  eveningDone: boolean;
}): ("morning" | "evening")[] {
  const due: ("morning" | "evening")[] = [];
  const morning = toMinutes(input.morningAt);
  const evening = toMinutes(input.eveningAt);
  if (!input.morningDone && input.minutes >= morning && input.minutes < Math.max(MORNING_DEADLINE, morning + 60)) {
    due.push("morning");
  }
  if (!input.eveningDone && input.minutes >= evening) due.push("evening");
  return due;
}
