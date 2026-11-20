import { DateTime } from "luxon";
import { config } from "../config.js";

export const zone = config.TIMEZONE;

export function now(): DateTime {
  return DateTime.now().setZone(zone);
}

/** Jour (AAAA-MM-JJ) dans le fuseau de Jarvis. */
export function parseDay(day: string): DateTime {
  const dt = DateTime.fromISO(day, { zone }).startOf("day");
  if (!dt.isValid) throw new Error(`Date invalide : ${day}`);
  return dt;
}

/** Date ISO venant de Claude ou de la web app ; sans décalage, elle est lue dans le fuseau de Jarvis. */
export function parseDateTime(value: string): Date {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) throw new Error(`Date invalide : ${value}`);
  return dt.toJSDate();
}

export function atTime(day: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(":").map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

export function formatTime(date: Date): string {
  return DateTime.fromJSDate(date, { zone }).toFormat("HH:mm");
}

export function formatDateTime(date: Date): string {
  return DateTime.fromJSDate(date, { zone }).setLocale("fr").toFormat("cccc d LLLL 'à' HH:mm");
}
