export type Priority = "low" | "normal" | "high" | "urgent";

export interface Space {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  durationMin: number;
  priority: Priority;
  deadline: string | null;
  status: "todo" | "done";
  spaces: string[];
}

export interface DayPlan {
  day: string;
  events: { id: string; title: string; start: string; end: string; allDay: boolean }[];
  blocks: { id: string; taskId: string | null; title: string; startsAt: string; endsAt: string }[];
  calendar: "connected" | "not_configured" | "error";
}

export interface PendingAction {
  id: string;
  summary: string;
}

const TOKEN_KEY = "jarvis-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : le jeton sera redemandé.
  }
}

export class UnauthorizedError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  // /api/jarvis renvoie une phrase à afficher même quand il échoue.
  if (!res.ok && !data.reponse) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export const api = {
  spaces: () => call<Space[]>("GET", "/spaces"),
  tasks: () => call<{ open: Task[]; done: Task[] }>("GET", "/tasks"),
  planning: () => call<DayPlan>("GET", "/planning"),
  pendingActions: () => call<PendingAction[]>("GET", "/actions/pending"),
  ask: (message: string) => call<{ reponse: string }>("POST", "/jarvis", { message }),
  createTask: (task: Partial<Task>) => call<Task>("POST", "/tasks", task),
  completeTask: (id: string) => call<Task>("POST", `/tasks/${id}/complete`, {}),
  reopenTask: (id: string) => call<Task>("POST", `/tasks/${id}/reopen`),
  deleteTask: (id: string) => call<void>("DELETE", `/tasks/${id}`),
  resolveAction: (id: string, decision: "confirm" | "reject") =>
    call<PendingAction>("POST", `/actions/${id}/${decision}`),
};
