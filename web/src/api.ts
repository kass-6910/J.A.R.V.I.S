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

export interface StockLine {
  item: { id: number; name: string; unit: string | null; qty: number; supplier: { name: string } | null };
  threshold: number;
  perDay: number;
  daysLeft: number | null;
  ruptureDate: string | null;
  toOrder: number;
}

export interface CoverageGap {
  date: string;
  start: string;
  end: string;
  absent: string[];
  suggestions: string[];
}

export interface SalesDay {
  date: string;
  ca: number;
  ca_encaisse: number;
  commandes: number;
}

export interface ShopStatus {
  slug: string;
  name: string;
  fetchedAt: string;
  sales: { yesterday: SalesDay; lastWeek: SalesDay };
  low: StockLine[];
  ruptures: StockLine[];
  gapsToday: CoverageGap[];
  gapsTomorrow: CoverageGap[];
  unpublishedWeek: string | null;
}

export interface ShoppingItem {
  id: string;
  name: string;
  qty: string | null;
  source: string;
  checkedAt: string | null;
}

export interface LifeOverview {
  care: { id: string; name: string; kind: "rendez_vous" | "produit"; everyDays: number; nextOn: string; lastDoneOn: string | null }[];
  supplementsToday: {
    supplement: { id: string; name: string; moment: string; withMeal: boolean; stockDoses: number | null };
    at: string;
    takenAt: string | null;
  }[];
  admin: { id: string; title: string; dueOn: string; notes: string | null }[];
  birthdays: { contact: { id: string; name: string; relation: string | null }; on: string; age: number | null; inDays: number }[];
  toCall: { contact: { id: string; name: string; relation: string | null }; lateDays: number }[];
  contacts: { id: string; name: string; relation: string | null; lastContactOn: string | null }[];
  routines: { moment: string; time: string; items: string }[];
}

export interface MealPlan {
  id: string;
  day: string;
  slot: "matin" | "midi" | "collation" | "soir";
  title: string;
  description: string;
  kcal: number;
  proteinG: number;
}

export interface Expense {
  id: string;
  spentOn: string;
  amountCents: number;
  label: string;
  merchant: string | null;
  category: string;
  space: string;
  source: string;
  receiptFile: string | null;
}

export interface Budget {
  month: string;
  status: { spent: number; limit: number; projected: number; level: number };
  byCategory: { category: string; label: string; cents: number }[];
  professional: { space: string; cents: number }[];
  expenses: Expense[];
  subscriptions: { id: string; name: string; amountCents: number; dayOfMonth: number }[];
}

export interface Garment {
  id: string;
  type: string;
  label: string;
  color: string;
  style: string;
  warmth: string;
}

export interface TodayOutfit {
  day: string;
  items: Garment[];
  sportBag: Garment | null;
  reason: string;
}

export interface Place {
  id: string;
  slug: string;
  name: string;
  kind: "salle" | "boutique" | "ecole" | "maison" | "autre";
  address: string | null;
}

export interface PlacesInfo {
  places: Place[];
  here: { place: Place; since: string } | null;
  pending: { id: string; at: string; place: Place }[];
}

export interface Settings {
  connections: { key: string; label: string; status: "connected" | "partial" | "missing"; detail?: string | null }[];
  preferences: {
    prayerMethod: number | null;
    budgetMonthlyEur: number;
    mealKcal: number;
    sportPerWeek: number;
    travelMode: "TRANSIT" | "DRIVE";
    briefingTime: string;
    eveningTime: string;
  };
}

export interface Exam {
  id: string;
  title: string;
  day: string;
  time: string | null;
  source: string;
  inDays: number;
  revisionsDone: number;
  revisionTaskIds: string[];
}

export interface Course {
  id: string;
  title: string;
  subject: string | null;
  summary: string;
  sheet: string;
  quiz: { question: string; answer: string }[];
}

export interface PendingAction {
  id: string;
  tool: string;
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
  shops: () => call<{ configured: boolean; shops: ShopStatus[] }>("GET", "/shops"),
  syncManageo: () => call<unknown>("POST", "/manageo/sync"),
  shopping: () => call<{ toBuy: ShoppingItem[]; bought: ShoppingItem[] }>("GET", "/shopping"),
  addShopping: (name: string) => call<ShoppingItem>("POST", "/shopping", { name }),
  checkShopping: (id: string, checked: boolean) => call<ShoppingItem>("POST", `/shopping/${id}/check`, { checked }),
  life: () => call<LifeOverview>("GET", "/life"),
  budget: () => call<Budget>("GET", "/budget"),
  places: () => call<PlacesInfo>("GET", "/places"),
  setPlaceAddress: (slug: string, address: string) => call<Place>("PATCH", `/places/${slug}`, { address }),
  answerArrival: (id: string, answer: "present" | "passing") =>
    call<{ message: string }>("POST", `/location/${id}/answer`, { answer }),
  school: () => call<{ exams: Exam[]; courses: Course[] }>("GET", "/school"),
  addExam: (title: string, day: string) => call<unknown>("POST", "/exams", { title, day }),
  addCourse: (pdf: string, fileName: string) => call<Course>("POST", "/courses", { pdf, fileName }),
  removeCourse: (id: string) => call<void>("DELETE", `/courses/${id}`),
  settings: () => call<Settings>("GET", "/settings"),
  wardrobe: () => call<{ items: Garment[]; outfit: TodayOutfit | null }>("GET", "/wardrobe"),
  addGarment: (image: string, mediaType: string) => call<Garment>("POST", "/wardrobe", { image, mediaType }),
  removeGarment: (id: string) => call<void>("DELETE", `/wardrobe/${id}`),
  otherOutfit: () => call<TodayOutfit>("POST", "/wardrobe/outfit"),
  addExpense: (amount: string, label: string, category: string) =>
    call<Expense>("POST", "/expenses", { amount, label, category }),
  addReceipt: (image: string, mediaType: string) => call<Expense>("POST", "/expenses/photo", { image, mediaType }),
  removeExpense: (id: string) => call<void>("DELETE", `/expenses/${id}`),
  meals: () =>
    call<{ meals: MealPlan[]; target: { kcal: number; sportToday: boolean } }>("GET", "/meals"),
  supplementTaken: (id: string) => call<unknown>("POST", `/supplements/${id}/taken`),
  careDone: (id: string) => call<unknown>("POST", `/care/${id}/done`),
  adminDone: (id: string) => call<unknown>("POST", `/admin/${id}/done`),
  contactCalled: (id: string) => call<unknown>("POST", `/contacts/${id}/called`),
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

/** Image protégée par le jeton : chargée par fetch, affichée par une URL locale. */
export async function authedImage(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new Error(`Image indisponible (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
