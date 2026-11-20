import { useState } from "react";
import { api, type Mail, type Priority, type Space, type Task } from "./api";

/** Composants partagés entre les écrans. */

export type Act = (action: () => Promise<unknown>) => Promise<void>;

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "Haute", normal: "Normale", low: "Basse" };

export function duration(min: number): string {
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60}`;
}

export function SpaceDots({ slugs, spaces }: { slugs: string[]; spaces: Space[] }) {
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

export function TaskRow({ task, spaces, act }: { task: Task; spaces: Space[]; act: Act }) {
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

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

/** Un mail trié : expéditeur, résumé, badges ; touché, il montre le texte complet. */
export function MailRow({ mail, spaces, act }: { mail: Mail; spaces: Space[]; act: Act }) {
  const [open, setOpen] = useState(false);
  const handled = mail.handledAt !== null;
  return (
    <li className={`card mail ${handled ? "handled" : ""}`}>
      <button className="mail-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mail-head">
          <span className="title">{mail.fromName}</span>
          <span className="muted">{dayTime(mail.receivedAt)}</span>
        </span>
        <span className="mail-summary">{mail.summary ?? mail.subject}</span>
        <span className="meta">
          {mail.provider === "outlook" ? "Outlook" : "Gmail"}
          {mail.importance === "high" && <span className="badge high">Important</span>}
          {mail.needsReply && !handled && <span className="badge">Réponse attendue</span>}
          <SpaceDots slugs={mail.spaces} spaces={spaces} />
        </span>
        {open && (
          <span className="mail-body">
            <strong>{mail.subject}</strong>
            {"\n\n"}
            {mail.body}
          </span>
        )}
      </button>
      <div className="row">
        <button onClick={() => act(() => api.setMailHandled(mail.id, !handled))}>
          {handled ? "À suivre" : "Traité"}
        </button>
      </div>
    </li>
  );
}
