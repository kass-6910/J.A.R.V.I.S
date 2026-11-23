import { useState } from "react";
import { api, type Mail, type Priority, type ShopStatus, type Space, type Task } from "./api";

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

const qty = (n: number, unit: string | null) => `${Math.round(n * 10) / 10}${unit ? ` ${unit}` : ""}`;
const euros = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;

/** Ce qui demande une action dans une boutique : stock bas, ruptures prévues, trous de planning. */
export function ShopAlerts({ shop, pendingOrders }: { shop: ShopStatus; pendingOrders: number }) {
  const gaps = shop.gapsToday;
  if (shop.low.length === 0 && shop.ruptures.length === 0 && gaps.length === 0) return null;
  return (
    <div className="card shop-alert">
      <strong>
        {shop.low.length > 0 ? "Stock bas" : shop.ruptures.length > 0 ? "Rupture prévue" : "Planning"} · {shop.name}
      </strong>
      {shop.low.length > 0 && (
        <p>{shop.low.map((l) => `${l.item.name} (${qty(l.item.qty, l.item.unit)})`).join(", ")}</p>
      )}
      {shop.ruptures.length > 0 && (
        <p>
          {shop.ruptures.map((l) => `${l.item.name} dans ${Math.floor(l.daysLeft ?? 0)} j`).join(", ")}
        </p>
      )}
      {gaps.map((g) => (
        <p key={`${g.start}-${g.end}`}>
          Personne de {g.start} à {g.end}
          {g.absent.length > 0 && ` (${g.absent.join(", ")} absent)`}
          {g.suggestions.length > 0 ? ` · appeler ${g.suggestions.join(" ou ")}` : " · aucun disponible connu"}
        </p>
      ))}
      {pendingOrders > 0 && (
        <p className="muted">
          {pendingOrders > 1 ? `${pendingOrders} commandes proposées` : "Commande proposée"}, à valider ci-dessus
        </p>
      )}
    </div>
  );
}

/** Section Manageo du tableau d'une boutique. */
export function ShopBoard({ shop }: { shop: ShopStatus }) {
  const { yesterday, lastWeek } = shop.sales;
  const diff = lastWeek.ca > 0 ? Math.round(((yesterday.ca - lastWeek.ca) / lastWeek.ca) * 100) : null;
  const fetched = new Date(shop.fetchedAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
  const lines = [...shop.low, ...shop.ruptures];
  return (
    <>
      <h2>Boutique · Manageo</h2>
      <div className="card shop-board">
        <div className="kpi">
          <span className="muted">Chiffre d'affaires d'hier</span>
          <span className="kpi-value">{euros(yesterday.ca)}</span>
          <span className="muted">
            {yesterday.commandes} commande{yesterday.commandes > 1 ? "s" : ""}
            {diff !== null && (
              <span className={diff >= 0 ? "up" : "down"}>
                {" "}
                · {diff >= 0 ? "+" : ""}
                {diff} % vs semaine dernière
              </span>
            )}
          </span>
        </div>
        {lines.length > 0 && (
          <ul className="stock-lines">
            {lines.map((l) => (
              <li key={l.item.id}>
                <span>
                  {l.item.name}
                  <span className="muted"> · {qty(l.item.qty, l.item.unit)}</span>
                </span>
                <span className={shop.low.includes(l) ? "badge urgent" : "badge high"}>
                  {shop.low.includes(l) ? "Sous le seuil" : `Rupture dans ${Math.floor(l.daysLeft ?? 0)} j`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {[...shop.gapsToday.map((g) => ["Aujourd'hui", g] as const), ...shop.gapsTomorrow.map((g) => ["Demain", g] as const)].map(
          ([label, g]) => (
            <p key={`${g.date}-${g.start}`}>
              {label} : personne de {g.start} à {g.end}
              {g.suggestions.length > 0 && <span className="muted"> · disponibles : {g.suggestions.join(", ")}</span>}
            </p>
          ),
        )}
        {shop.unpublishedWeek && <p className="muted">Planning de la semaine du {shop.unpublishedWeek} pas encore publié.</p>}
        <p className="muted footnote">Relevé à {fetched}</p>
      </div>
    </>
  );
}
