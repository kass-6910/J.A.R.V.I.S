import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";

/** Adresse du serveur et jeton de Jarvis, rangés dans le trousseau de l'iPhone. */
export interface Connection {
  url: string;
  token: string;
}

const URL_KEY = "jarvis-url";
const TOKEN_KEY = "jarvis-token";
export const DEFAULT_URL = "https://jarvis.kassdev.fr";

export async function loadConnection(): Promise<Connection | null> {
  const [url, token] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  return token ? { url: url ?? DEFAULT_URL, token } : null;
}

export async function saveConnection(c: Connection | null): Promise<void> {
  if (!c) {
    await Promise.all([SecureStore.deleteItemAsync(URL_KEY), SecureStore.deleteItemAsync(TOKEN_KEY)]);
    return;
  }
  await SecureStore.setItemAsync(URL_KEY, c.url.replace(/\/+$/, ""));
  await SecureStore.setItemAsync(TOKEN_KEY, c.token.trim());
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Jeton refusé.");
  }
}

async function call<T>(c: Connection, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${c.url}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export interface DayPlan {
  day: string;
  events: { id: string; title: string; start: string; end: string; allDay: boolean }[];
  blocks: { id: string; kind: "task" | "prayer" | "sport" | "meal"; title: string; startsAt: string; endsAt: string }[];
  calendar: "connected" | "not_configured" | "error";
}

export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
}

export interface UsageSummary {
  today: number;
  month: number;
  projection: number;
  budget: number;
  requestsToday: number;
}

export const api = {
  planning: (c: Connection) => call<DayPlan>(c, "GET", "/planning"),
  pendingActions: (c: Connection) => call<PendingAction[]>(c, "GET", "/actions/pending"),
  resolveAction: (c: Connection, id: string, decision: "confirm" | "reject") =>
    call<PendingAction>(c, "POST", `/actions/${id}/${decision}`),
  usage: (c: Connection) => call<UsageSummary>(c, "GET", "/usage"),
  /** Vérifie le jeton sur une route protégée. */
  check: (c: Connection) => call<unknown>(c, "GET", "/actions/pending"),
};

/**
 * Pose une question à Jarvis et reçoit la réponse au fil de l'eau (Server-Sent Events).
 * onText reçoit chaque morceau ; la promesse rend la réponse complète.
 */
export async function askStream(c: Connection, message: string, onText: (delta: string) => void): Promise<string> {
  const res = await expoFetch(`${c.url}/api/jarvis/stream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok || !res.body) throw new Error(`Erreur ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const line = buffer.slice(0, end).replace(/^data: /, "");
      buffer = buffer.slice(end + 2);
      const event = JSON.parse(line) as { type: "text"; text: string } | { type: "done" | "error"; reponse: string };
      if (event.type === "text") {
        received += event.text;
        onText(event.text);
      } else if (event.type === "error") {
        throw new Error(event.reponse);
      } else {
        return event.reponse || received;
      }
    }
  }
  return received;
}
