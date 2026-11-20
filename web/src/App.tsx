import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  getToken,
  setToken,
  UnauthorizedError,
  type DayPlan,
  type PendingAction,
  type Priority,
  type Space,
  type Task,
} from "./api";

interface Data {
  spaces: Space[];
  open: Task[];
  done: Task[];
  plan: DayPlan;
  pending: PendingAction[];
}

const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "Haute", normal: "Normale", low: "Basse" };

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function duration(min: number): string {
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60}`;
}

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [tab, setTab] = useState<"home" | "tasks">("home");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [spaces, tasks, plan, pending] = await Promise.all([
        api.spaces(),
        api.tasks(),
        api.planning(),
        api.pendingActions(),
      ]);
      setData({ spaces, ...tasks, plan, pending });
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
        ) : (
          <Tasks data={data} act={act} />
        )}
      </main>
      <nav>
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          Accueil
        </button>
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>
          Tâches
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

type Act = (action: () => Promise<unknown>) => Promise<void>;

function SpaceDots({ slugs, spaces }: { slugs: string[]; spaces: Space[] }) {
  const matched = spaces.filter((s) => slugs.includes(s.slug));
  if (matched.length === 0) return null;
  return (
    <span className="spaces">
      {matched.map((s) => (
        <span key={s.slug} className="space">
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </span>
  );
}

function Home({ data, act, refresh }: { data: Data; act: Act; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { reponse } = await api.ask(text);
      setReply(reponse);
      setMessage("");
    } catch (err) {
      setReply(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const taskById = new Map(data.open.map((t) => [t.id, t]));
  const agenda = [
    ...data.plan.events.map((e) => ({
      key: `e-${e.id}`,
      at: e.start,
      label: e.allDay ? "Journée" : `${time(e.start)} – ${time(e.end)}`,
      title: e.title,
      slugs: [] as string[],
      source: "Agenda",
    })),
    ...data.plan.blocks.map((b) => ({
      key: `b-${b.id}`,
      at: b.startsAt,
      label: `${time(b.startsAt)} – ${time(b.endsAt)}`,
      title: b.title,
      slugs: (b.taskId && taskById.get(b.taskId)?.spaces) || [],
      source: "Tâche",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <header>
        <h1>Bonjour Jessim</h1>
        <p className="muted">{today}</p>
      </header>

      <form className="ask" onSubmit={send}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Écris à Jarvis…"
          aria-label="Message pour Jarvis"
        />
        <button className="primary" type="submit" disabled={busy || !message.trim()}>
          {busy ? "…" : "Envoyer"}
        </button>
      </form>
      {reply && <p className="card reply">{reply}</p>}

      {data.pending.map((action) => (
        <div key={action.id} className="card pending">
          <div>
            <strong>À valider</strong>
            <p>{action.summary}</p>
          </div>
          <div className="row">
            <button onClick={() => act(() => api.resolveAction(action.id, "reject"))}>Refuser</button>
            <button className="primary" onClick={() => act(() => api.resolveAction(action.id, "confirm"))}>
              Valider
            </button>
          </div>
        </div>
      ))}

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
            <li key={item.key} className="card slot">
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

function TaskRow({ task, spaces, act }: { task: Task; spaces: Space[]; act: Act }) {
  const done = task.status === "done";
  return (
    <li className={`card task ${done ? "done" : ""}`}>
      <button
        className="check"
        aria-label={done ? `Rouvrir ${task.title}` : `Marquer ${task.title} comme faite`}
        aria-pressed={done}
        onClick={() => act(() => (done ? api.reopenTask(task.id) : api.completeTask(task.id)))}
      />
      <span className="what">
        <span className="title">{task.title}</span>
        <span className="meta">
          {duration(task.durationMin)}
          {task.deadline &&
            ` · pour le ${new Date(task.deadline).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })}`}
          <SpaceDots slugs={task.spaces} spaces={spaces} />
        </span>
      </span>
      {!done && task.priority !== "normal" && (
        <span className={`badge ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
      )}
      <button
        className="ghost"
        aria-label={`Supprimer ${task.title}`}
        onClick={() => window.confirm(`Supprimer « ${task.title} » ?`) && act(() => api.deleteTask(task.id))}
      >
        ✕
      </button>
    </li>
  );
}
