import { config } from "../../config.js";
import { zone } from "../../lib/time.js";
import { getAccessToken, isGoogleConfigured } from "./oauth.js";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

export const isCalendarConfigured = isGoogleConfigured;

interface GoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  transparency?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

async function listCalendar(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const token = await getAccessToken();
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.search = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      timeZone: zone,
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Agenda (${calendarId}) a répondu ${res.status} : ${await res.text()}`);
    const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const item of body.items ?? []) {
      // Annulé, ou marqué « disponible » : n'occupe pas la journée.
      if (item.status === "cancelled" || item.transparency === "transparent") continue;
      const start = item.start.dateTime ?? item.start.date;
      const end = item.end.dateTime ?? item.end.date;
      if (!start || !end) continue;
      events.push({
        id: item.id,
        title: item.summary ?? "(sans titre)",
        start: new Date(start),
        end: new Date(end),
        allDay: !item.start.dateTime,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return events;
}

const cache = new Map<string, { at: number; events: CalendarEvent[] }>();
const CACHE_MS = 2 * 60_000;

/** Rendez-vous de tous les agendas configurés, triés par heure de début. */
export async function listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  if (!isCalendarConfigured()) return [];
  const key = `${from.getTime()}-${to.getTime()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;

  const ids = config.GOOGLE_CALENDAR_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  const lists = await Promise.all(ids.map((id) => listCalendar(id, from, to)));
  const events = lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
  cache.clear();
  cache.set(key, { at: Date.now(), events });
  return events;
}
