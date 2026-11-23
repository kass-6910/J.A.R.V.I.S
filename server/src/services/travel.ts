import { DateTime } from "luxon";
import { config } from "../config.js";
import { isCalendarConfigured, listEvents, type CalendarEvent } from "../connectors/google/calendar.js";
import { isMapsConfigured, travelMinutes } from "../connectors/maps/routes.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import type { Interval } from "../planner/schedule.js";
import {
  departureAt,
  googleMapsUrl,
  shouldAlertDeparture,
  shouldRefreshTravel,
  wazeUrl,
  type TravelMode,
} from "../travel/rules.js";
import { now, zone } from "../lib/time.js";
import { getValue, setValue } from "./kv.js";
import { currentPlace } from "./places.js";

interface TravelInfo {
  minutes: number;
  mode: TravelMode;
  origin: string;
  computedAt: number;
  alertedAt: number | null;
}

const key = (event: CalendarEvent) => `travel:${event.id}:${event.start.toISOString()}`;

async function load(event: CalendarEvent): Promise<TravelInfo | null> {
  const raw = await getValue(key(event));
  return raw ? (JSON.parse(raw) as TravelInfo) : null;
}

/** Point de départ : le lieu confirmé s'il a une adresse, sinon la maison. */
async function origin(): Promise<string | null> {
  const here = await currentPlace();
  return here?.place.address || config.HOME_ADDRESS || null;
}

/**
 * Pour chaque rendez-vous de l'agenda avec une adresse : temps de trajet (trafic compris),
 * puis alerte « pars maintenant » avec les liens Google Maps et Waze.
 */
export async function runTravel(): Promise<void> {
  if (!isMapsConfigured() || !isCalendarConfigured()) return;
  const current = now();
  const events = (await listEvents(current.toJSDate(), current.plus({ hours: 4 }).toJSDate())).filter(
    (e) => !e.allDay && e.location && e.start.getTime() > current.toMillis(),
  );
  const from = await origin();
  if (!from) return;

  for (const event of events) {
    let info = await load(event);
    if (shouldRefreshTravel(current.toMillis(), event.start.getTime(), info?.computedAt ?? null)) {
      try {
        const minutes = await travelMinutes(from, event.location!, config.TRAVEL_MODE, event.start);
        info = { minutes, mode: config.TRAVEL_MODE, origin: from, computedAt: Date.now(), alertedAt: info?.alertedAt ?? null };
        await setValue(key(event), JSON.stringify(info));
      } catch (err) {
        console.error(`Trajet vers « ${event.title} » impossible :`, err);
        continue;
      }
    }
    if (!info || info.alertedAt || !isNotifyConfigured()) continue;
    const departure = departureAt(event.start.getTime(), info.minutes, config.TRAVEL_BUFFER_MIN);
    if (!shouldAlertDeparture(Date.now(), departure, event.start.getTime())) continue;

    const at = DateTime.fromJSDate(event.start, { zone }).toFormat("HH:mm");
    const how = info.mode === "TRANSIT" ? "en TCL" : "en voiture";
    await sendNotification({
      title: "Pars maintenant",
      message: `${event.title} à ${at} : ${info.minutes} min ${how}.`,
      priority: 4,
      tags: ["runner"],
      click: googleMapsUrl(event.location!, info.mode),
      actions: [
        { label: "Google Maps", url: googleMapsUrl(event.location!, info.mode), kind: "view" },
        { label: "Waze", url: wazeUrl(event.location!), kind: "view" },
      ],
    });
    await setValue(key(event), JSON.stringify({ ...info, alertedAt: Date.now() }));
  }
}

/** Temps de trajet déjà calculés, à bloquer dans le planning avant chaque rendez-vous. */
export async function travelIntervals(events: CalendarEvent[]): Promise<Interval[]> {
  const out: Interval[] = [];
  for (const event of events.filter((e) => !e.allDay && e.location)) {
    const info = await load(event);
    if (info) out.push({ start: event.start.getTime() - info.minutes * 60_000, end: event.start.getTime() });
  }
  return out;
}

/** Trajets du jour connus, pour le contexte et le briefing. */
export async function travelFacts(events: CalendarEvent[]): Promise<string[]> {
  const lines: string[] = [];
  for (const event of events.filter((e) => !e.allDay && e.location)) {
    const info = await load(event);
    if (!info) continue;
    const leave = DateTime.fromMillis(departureAt(event.start.getTime(), info.minutes, config.TRAVEL_BUFFER_MIN), { zone }).toFormat("HH:mm");
    lines.push(`- ${event.title} : ${info.minutes} min ${info.mode === "TRANSIT" ? "en TCL" : "en voiture"}, départ vers ${leave}`);
  }
  return lines.length > 0 ? ["Trajets :", ...lines] : [];
}
