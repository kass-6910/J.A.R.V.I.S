import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  getToken,
  setToken,
  UnauthorizedError,
  type Briefing,
  type DayPlan,
  type Mail,
  type MailStatus,
  type PrayerInfo,
  type Reminder,
  type PendingAction,
  type Priority,
  type Space,
  type Task,
} from "./api";
import { canListen, listen, speak, unlockSpeech } from "./voice";
import { type Act, MailRow, PRIORITY_LABEL, SpaceDots, TaskRow, duration } from "./components";
import { Health } from "./Health";
import { Spaces } from "./Spaces";

const REMINDER_LABEL: Record<Reminder["level"], string> = {
  notification: "Notification",
  iphone: "Rappel iPhone",
  alarm: "Alarme",
};

/** « 14:30 » aujourd'hui, « demain 9:00 », sinon « sam. 22 nov. 9:00 ». */
function reminderWhen(iso: string): string {
  const date = new Date(iso);
  const opts = { timeZone: "Europe/Paris" } as const;
  const dayKey = (d: Date) => d.toLocaleDateString("fr-FR", opts);
  const hour = date.toLocaleTimeString("fr-FR", { ...opts, hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (dayKey(date) === dayKey(today)) return hour;
  if (dayKey(date) === dayKey(tomorrow)) return `demain ${hour}`;
  return `${date.toLocaleDateString("fr-FR", { ...opts, weekday: "short", day: "numeric", month: "short" })} ${hour}`;
}

const BLOCK_SOURCE: Record<DayPlan["blocks"][number]["kind"], string> = {
  task: "Tâche",
  prayer: "Prière · créneau protégé",
  sport: "Sport · déplacé si la journée change",
  meal: "Repas",
};

const BRIEFING_TITLE = { morning: "Briefing du matin", evening: "Bilan du soir" } as const;

function BriefingCard({ briefings, act }: { briefings: Briefing[]; act: Act }) {
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const latest = briefings[0];

  async function write() {
    setWriting(true);
    const kind = new Date().getHours() >= 18 ? "evening" : "morning";
    await act(() => api.writeBriefing(kind));
    setWriting(false);
  }

  if (!latest) {
    return (
      <div className="card briefing">
        <strong>Briefing</strong>
        <p className="muted">Pas encore de briefing aujourd'hui.</p>
        <div className="row">
          <button onClick={write} disabled={writing}>
            {writing ? "Rédaction…" : "Le rédiger maintenant"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card briefing">
      <strong>{BRIEFING_TITLE[latest.kind]}</strong>
      <p className={open ? "" : "clamp"}>{latest.text}</p>
      <div className="row">
        <button onClick={() => setOpen(!open)}>{open ? "Réduire" : "Tout lire"}</button>
        <button className="primary" onClick={() => speak(latest.text)}>
          Écouter
        </button>
      </div>
    </div>
  );
}

interface Data {
  spaces: Space[];
  open: Task[];
  done: Task[];
  plan: DayPlan;
  pending: PendingAction[];
  briefings: Briefing[];
  reminders: Reminder[];
  mails: Mail[];
  mailStatus: MailStatus;
  prayer: PrayerInfo;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [tab, setTab] = useState<"home" | "tasks" | "spaces" | "health">("home");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [spaces, tasks, plan, pending, briefings, reminders, mails, prayer] = await Promise.all([
        api.spaces(),
        api.tasks(),
        api.planning(),
        api.pendingActions(),
        api.briefings(),
        api.reminders(),
        api.mails("?days=3"),
        api.prayer(),
      ]);
      setData({ spaces, ...tasks, plan, pending, briefings, reminders, mails: mails.mails, mailStatus: mails.status, prayer });
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setToken(null);
        setAuthed(false);
      } else {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      }
    }
  }, []);

  /** Lance une action puis recharge : la journée est recalée côté serveur à chaque changement. */
  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (!authed) return;
    void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authed, refresh]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="app">
      <main>
        {error && <p className="banner critical">{error}</p>}
        {!data ? (
          !error && <p className="muted">Chargement…</p>
        ) : tab === "home" ? (
          <Home data={data} act={act} refresh={refresh} />
        ) : tab === "tasks" ? (
          <Tasks data={data} act={act} />
        ) : tab === "spaces" ? (
          <Spaces spaces={data.spaces} act={act} version={data} />
        ) : (
          <Health plan={data.plan} prayer={data.prayer} act={act} version={data} />
        )}
      </main>
      <nav>
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          Accueil
        </button>
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>
          Tâches
        </button>
        <button className={tab === "spaces" ? "active" : ""} onClick={() => setTab("spaces")}>
          Espaces
        </button>
        <button className={tab === "health" ? "active" : ""} onClick={() => setTab("health")}>
          Santé
        </button>
      </nav>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setToken(value.trim());
    onDone();
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1>Jarvis</h1>
      <p className="muted">Entre le jeton secret du serveur pour connecter cet appareil.</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Jeton"
        autoComplete="current-password"
        aria-label="Jeton secret"
      />
      <button className="primary" type="submit">
        Connecter
      </button>
    </form>
  );
}

function Home({ data, act, refresh }: { data: Data; act: Act; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);

  async function ask(text: string, aloud: boolean) {
    if (!text || busy) return;
    setBusy(true);
    try {
      const { reponse } = await api.ask(text);
      setReply(reponse);
      setMessage("");
      if (aloud) speak(reponse);
    } catch (err) {
      setReply(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    void ask(message.trim(), false);
  }

  function toggleMic() {
    if (listening) {
      stopListening.current?.();
      return;
    }
    unlockSpeech();
    setReply(null);
    setMessage("");
    setListening(true);
    stopListening.current = listen({
      onPartial: setMessage,
      onFinal: (text) => {
        setListening(false);
        if (text) void ask(text, true);
      },
      onError: (msg) => {
        setListening(false);
        setReply(msg);
      },
    });
  }

  useEffect(() => () => stopListening.current?.(), []);

  const taskById = new Map(data.open.map((t) => [t.id, t]));
  const agenda = [
    ...data.plan.events.map((e) => ({
      key: `e-${e.id}`,
      at: e.start,
      label: e.allDay ? "Journée" : `${time(e.start)} – ${time(e.end)}`,
      title: e.title,
      slugs: [] as string[],
      source: "Agenda",
      kind: "event",
      past: new Date(e.end).getTime() < Date.now(),
    })),
    ...data.plan.blocks.map((b) => ({
      key: `b-${b.id}`,
      at: b.startsAt,
      label: `${time(b.startsAt)} – ${time(b.endsAt)}`,
      title: b.title,
      slugs: (b.taskId && taskById.get(b.taskId)?.spaces) || [],
      source: BLOCK_SOURCE[b.kind],
      kind: b.kind as string,
      past: new Date(b.endsAt).getTime() < Date.now(),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <header>
        <h1>Bonjour Jessim</h1>
        <p className="muted">{today}</p>
      </header>

      {canListen() && (
        <div className="mic-area">
          <button
            type="button"
            className={`mic ${listening ? "on" : ""}`}
            onClick={toggleMic}
            disabled={busy}
            aria-label={listening ? "Arrêter l'écoute" : "Parler à Jarvis"}
            aria-pressed={listening}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <p className="muted">{busy ? "Jarvis réfléchit…" : listening ? "Je t'écoute…" : "Touche pour parler"}</p>
        </div>
      )}

      <form className="ask" onSubmit={send}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={listening ? "" : "Ou écris à Jarvis…"}
          aria-label="Message pour Jarvis"
          readOnly={listening}
        />
        <button className="primary" type="submit" disabled={busy || listening || !message.trim()}>
          {busy ? "…" : "Envoyer"}
        </button>
      </form>
      {reply && <p className="card reply">{reply}</p>}

      <BriefingCard briefings={data.briefings} act={act} />
      {data.prayer.hadith && (
        <div className="card hadith">
          <strong>Rappel du jour</strong>
          <p>{data.prayer.hadith.text}</p>
          <p className="muted">
            {data.prayer.hadith.collection}, n° {data.prayer.hadith.number}
            {data.prayer.hadith.grade && ` · ${data.prayer.hadith.grade}`}
          </p>
        </div>
      )}

      {data.pending.map((action) => (
        <div key={action.id} className="card pending">
          <div>
            <strong>À valider</strong>
            <p className="pending-text">{action.summary}</p>
          </div>
          <div className="row">
            <button onClick={() => act(() => api.resolveAction(action.id, "reject"))}>Refuser</button>
            <button className="primary" onClick={() => act(() => api.resolveAction(action.id, "confirm"))}>
              Valider
            </button>
          </div>
        </div>
      ))}

      {data.reminders.length > 0 && (
        <>
          <h2>Rappels</h2>
          <ul className="list">
            {data.reminders.map((r) => (
              <li key={r.id} className="card slot">
                <span className="when">{reminderWhen(r.remindAt)}</span>
                <span className="what">
                  {r.title}
                  <span className="meta">{REMINDER_LABEL[r.level]}</span>
                </span>
                <button
                  className="ghost"
                  aria-label={`Annuler le rappel ${r.title}`}
                  onClick={() =>
                    window.confirm(
                      r.status === "on_device"
                        ? `Annuler « ${r.title} » ? Pense aussi à le supprimer de l'app Rappels ou Horloge.`
                        : `Annuler « ${r.title} » ?`,
                    ) && act(() => api.cancelReminder(r.id))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <MailsToWatch data={data} act={act} />

      <h2>Aujourd'hui</h2>
      {data.plan.calendar === "not_configured" && (
        <p className="banner">Google Agenda n'est pas encore connecté : seules les tâches sont placées.</p>
      )}
      {data.plan.calendar === "error" && (
        <p className="banner critical">Google Agenda est injoignable : les rendez-vous manquent.</p>
      )}
      {agenda.length === 0 ? (
        <p className="muted">Rien de prévu pour le reste de la journée.</p>
      ) : (
        <ul className="list">
          {agenda.map((item) => (
            <li key={item.key} className={`card slot ${item.kind} ${item.past ? "past" : ""}`}>
              <span className="when">{item.label}</span>
              <span className="what">
                {item.title}
                <span className="meta">
                  {item.source}
                  <SpaceDots slugs={item.slugs} spaces={data.spaces} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Tasks({ data, act }: { data: Data; act: Act }) {
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [priority, setPriority] = useState<Priority>("normal");
  const [space, setSpace] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await act(() => api.createTask({ title, durationMin, priority, spaces: space ? [space] : [] }));
    setTitle("");
  }

  return (
    <>
      <header>
        <h1>Tâches</h1>
        <p className="muted">Dans l'ordre où Jarvis les place</p>
      </header>

      <form className="card add" onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nouvelle tâche"
          aria-label="Titre de la tâche"
        />
        <div className="row">
          <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} aria-label="Durée">
            {[10, 15, 30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {duration(m)}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Priorité">
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <select value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Espace">
            <option value="">Sans espace</option>
            {data.spaces.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button className="primary" type="submit" disabled={!title.trim()}>
          Ajouter
        </button>
      </form>

      {data.open.length === 0 && <p className="muted">Aucune tâche à faire.</p>}
      <ul className="list">
        {data.open.map((task) => (
          <TaskRow key={task.id} task={task} spaces={data.spaces} act={act} />
        ))}
      </ul>

      {data.done.length > 0 && (
        <>
          <h2>Faites</h2>
          <ul className="list">
            {data.done.map((task) => (
              <TaskRow key={task.id} task={task} spaces={data.spaces} act={act} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Mails importants ou en attente de réponse, pas encore traités. */
function MailsToWatch({ data, act }: { data: Data; act: Act }) {
  const [syncing, setSyncing] = useState(false);
  const connected = Object.values(data.mailStatus).some((s) => s === "configured");
  if (!connected) return null;
  const toWatch = data.mails.filter((m) => m.importance === "high" || m.needsReply).slice(0, 5);

  async function sync() {
    setSyncing(true);
    await act(() => api.syncMails());
    setSyncing(false);
  }

  return (
    <>
      <div className="section-head">
        <h2>Mails à suivre</h2>
        <button className="link-button" onClick={sync} disabled={syncing}>
          {syncing ? "Relève…" : "Relever"}
        </button>
      </div>
      {toWatch.length === 0 ? (
        <p className="muted">Rien d'important en attente.</p>
      ) : (
        <ul className="list">
          {toWatch.map((mail) => (
            <MailRow key={mail.id} mail={mail} spaces={data.spaces} act={act} />
          ))}
        </ul>
      )}
    </>
  );
}
