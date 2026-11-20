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
  blocks: {
    id: string;
    kind: "task" | "prayer" | "sport" | "meal";
    taskId: string | null;
    title: string;
    startsAt: string;
    endsAt: string;
  }[];
  calendar: "connected" | "not_configured" | "error";
}

export type BriefingKind = "morning" | "evening";

export interface Briefing {
  id: string;
  day: string;
  kind: BriefingKind;
  text: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  title: string;
  remindAt: string;
  level: "notification" | "iphone" | "alarm";
  status: "scheduled" | "on_device";
}

export interface Mail {
  id: string;
  provider: "gmail" | "outlook";
  fromName: string;
  subject: string;
  summary: string | null;
  body: string;
  receivedAt: string;
  importance: "high" | "normal" | "low" | null;
  needsReply: boolean;
  schoolEvent: { kind: string; title: string; date: string | null } | null;
  handledAt: string | null;
  spaces: string[];
}

export type MailStatus = Record<"gmail" | "outlook", "configured" | "not_configured">;

export interface SpaceSummary {
  slug: string;
  name: string;
  color: string;
  openTasks: number;
  mails: number;
  importantMails: number;
}

export interface SpaceLink {
  type: "task" | "mail";
  id: string;
  title: string;
  spaces: string[];
}

export interface Hadith {
  collection: string;
  number: string;
  text: string;
  grade: string | null;
}

export interface PrayerInfo {
  enabled: boolean;
  times: Record<"fajr" | "dhuhr" | "asr" | "maghrib" | "isha", string> | null;
  hadith: Hadith | null;
}

export interface HealthDay {
  day: string;
  steps: number | null;
  activeKcal: number | null;
  sleepMin: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
}

export interface HealthSummary {
  lastNight: HealthDay | null;
  yesterday: HealthDay | null;
  week: { target: number; done: number; doneToday: boolean; days: string[] };
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
  briefings: () => call<Briefing[]>("GET", "/briefings"),
  prayer: () => call<PrayerInfo>("GET", "/prayer"),
  healthSummary: () => call<HealthSummary>("GET", "/health/summary"),
  logWorkout: () => call<unknown>("POST", "/health/workouts", {}),
  writeBriefing: (kind: BriefingKind) => call<Briefing>("POST", `/briefings/${kind}`),
  reminders: () => call<Reminder[]>("GET", "/reminders"),
  mails: (query = "") => call<{ status: MailStatus; mails: Mail[] }>("GET", `/mails${query}`),
  setMailHandled: (id: string, handled: boolean) => call<Mail>("POST", `/mails/${id}/handled`, { handled }),
  syncMails: () => call<{ added: number }>("POST", "/mails/sync"),
  spacesOverview: () => call<{ spaces: SpaceSummary[]; links: SpaceLink[] }>("GET", "/spaces/overview"),
  spaceBoard: (slug: string) => call<{ tasks: Task[]; mails: Mail[] }>("GET", `/spaces/${slug}`),
  cancelReminder: (id: string) => call<void>("DELETE", `/reminders/${id}`),
  ask: (message: string) => call<{ reponse: string }>("POST", "/jarvis", { message }),
  createTask: (task: Partial<Task>) => call<Task>("POST", "/tasks", task),
  completeTask: (id: string) => call<Task>("POST", `/tasks/${id}/complete`, {}),
  reopenTask: (id: string) => call<Task>("POST", `/tasks/${id}/reopen`),
  deleteTask: (id: string) => call<void>("DELETE", `/tasks/${id}`),
  resolveAction: (id: string, decision: "confirm" | "reject") =>
    call<PendingAction>("POST", `/actions/${id}/${decision}`),
};
