import { useEffect, useState } from "react";
import { api, type Mail, type ShopStatus, type Space, type SpaceLink, type SpaceSummary, type Task } from "./api";
import { type Act, MailRow, ShopBoard, SpaceDots, TaskRow } from "./components";
import { LifeBoard } from "./Life";
import { SchoolBoard } from "./School";

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/**
 * Écran Espaces : chaque espace avec sa couleur et ce qui l'occupe, les liens entre espaces,
 * puis le tableau d'un espace quand on le touche.
 * « version » change à chaque rechargement des données : l'écran se recharge avec.
 */
export function Spaces({
  spaces,
  shops,
  act,
  version,
}: {
  spaces: Space[];
  shops: ShopStatus[];
  act: Act;
  version: unknown;
}) {
  const [overview, setOverview] = useState<{ spaces: SpaceSummary[]; links: SpaceLink[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<{ tasks: Task[]; mails: Mail[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.spacesOverview().then(setOverview, (err: Error) => setError(err.message));
  }, [version]);

  useEffect(() => {
    if (!selected) return;
    setBoard(null);
    api.spaceBoard(selected).then(setBoard, (err: Error) => setError(err.message));
  }, [selected, version]);

  if (error) return <p className="banner critical">{error}</p>;
  if (!overview) return <p className="muted">Chargement…</p>;

  const current = overview.spaces.find((s) => s.slug === selected);
  if (current) {
    return (
      <>
        <header>
          <button className="back" onClick={() => setSelected(null)}>
            ‹ Espaces
          </button>
          <h1 className="space-title">
            <i style={{ background: current.color }} />
            {current.name}
          </h1>
        </header>
        {current.slug === "vie-perso" && <LifeBoard act={act} version={version} />}
        {current.slug === "ecole" && <SchoolBoard act={act} version={version} />}
        {shops.find((s) => s.slug === current.slug) && <ShopBoard shop={shops.find((s) => s.slug === current.slug)!} />}
        {!board ? (
          <p className="muted">Chargement…</p>
        ) : (
          <>
            <h2>Tâches</h2>
            {board.tasks.length === 0 ? (
              <p className="muted">Aucune tâche à faire.</p>
            ) : (
              <ul className="list">
                {board.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} spaces={spaces} act={act} />
                ))}
              </ul>
            )}
            <h2>Mails de la semaine</h2>
            {board.mails.length === 0 ? (
              <p className="muted">Aucun mail à suivre.</p>
            ) : (
              <ul className="list">
                {board.mails.map((mail) => (
                  <MailRow key={mail.id} mail={mail} spaces={spaces} act={act} />
                ))}
              </ul>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <header>
        <h1>Espaces</h1>
        <p className="muted">Touche un espace pour ouvrir son tableau</p>
      </header>
      <div className="space-grid">
        {overview.spaces.map((space) => (
          <button
            key={space.slug}
            className="card space-card"
            style={{ borderColor: space.color }}
            onClick={() => setSelected(space.slug)}
          >
            <span className="space-name">
              <i style={{ background: space.color }} />
              {space.name}
            </span>
            <span className="muted">{plural(space.openTasks, "tâche")}</span>
            <span className="muted">
              {plural(space.mails, "mail")}
              {space.importantMails > 0 && <strong className="important"> · {space.importantMails} important{space.importantMails > 1 ? "s" : ""}</strong>}
            </span>
          </button>
        ))}
      </div>

      <h2>Liens entre espaces</h2>
      {overview.links.length === 0 ? (
        <p className="muted">Aucun élément ne touche plusieurs espaces en ce moment.</p>
      ) : (
        <ul className="list">
          {overview.links.map((link) => (
            <li key={link.id} className="card link">
              <span className="what">
                <span className="title">{link.title}</span>
                <span className="meta">
                  {link.type === "task" ? "Tâche" : "Mail"}
                  <SpaceDots slugs={link.spaces} spaces={spaces} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
