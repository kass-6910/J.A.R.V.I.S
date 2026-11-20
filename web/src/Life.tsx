import { type FormEvent, useEffect, useState } from "react";
import { api, type LifeOverview, type ShoppingItem } from "./api";
import { BudgetSection } from "./Budget";
import type { Act } from "./components";

const SOURCE_LABEL: Record<string, string> = {
  voix: "à la voix",
  app: "",
  soins: "soins",
  complement: "complément",
  menu: "menus",
};

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** Liste de courses partagée : ajout, coche, et ce qui a été acheté ces derniers jours. */
export function Shopping({ act, version }: { act: Act; version: unknown }) {
  const [list, setList] = useState<{ toBuy: ShoppingItem[]; bought: ShoppingItem[] } | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    api.shopping().then(setList, () => setList({ toBuy: [], bought: [] }));
  }, [version]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await act(() => api.addShopping(name.trim()));
    setName("");
  }

  return (
    <>
      <h2>Courses</h2>
      <form className="ask" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ajouter un article" aria-label="Article à ajouter" />
        <button className="primary" type="submit" disabled={!name.trim()}>
          Ajouter
        </button>
      </form>
      {list && (
        <ul className="list shopping">
          {list.toBuy.length === 0 && <li className="muted">La liste est vide.</li>}
          {[...list.toBuy, ...list.bought].map((item) => {
            const done = item.checkedAt !== null;
            return (
              <li key={item.id} className={`card task ${done ? "done" : ""}`}>
                <button
                  className="check"
                  aria-pressed={done}
                  aria-label={done ? `Remettre ${item.name} sur la liste` : `${item.name} acheté`}
                  onClick={() => act(() => api.checkShopping(item.id, !done))}
                />
                <span className="what">
                  <span className="title">{item.name}</span>
                  {(item.qty || SOURCE_LABEL[item.source]) && (
                    <span className="meta">{[item.qty, SOURCE_LABEL[item.source]].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Tableau de l'espace Vie perso : courses, papiers, proches, soins. */
export function LifeBoard({ act, version }: { act: Act; version: unknown }) {
  const [life, setLife] = useState<LifeOverview | null>(null);
  useEffect(() => {
    api.life().then(setLife, () => setLife(null));
  }, [version]);

  return (
    <>
      <Shopping act={act} version={version} />
      {life && (
        <>
          {life.admin.length > 0 && (
            <>
              <h2>Administratif</h2>
              <ul className="list">
                {life.admin.map((d) => (
                  <li key={d.id} className="card slot">
                    <span className="when">{longDate(d.dueOn)}</span>
                    <span className="what">
                      {d.title}
                      {d.notes && <span className="meta">{d.notes}</span>}
                    </span>
                    <button onClick={() => act(() => api.adminDone(d.id))}>Fait</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(life.birthdays.length > 0 || life.toCall.length > 0) && (
            <>
              <h2>Proches</h2>
              <ul className="list">
                {life.birthdays.map((b) => (
                  <li key={`b-${b.contact.id}`} className="card slot">
                    <span className="when">{b.inDays === 0 ? "Aujourd'hui" : longDate(b.on)}</span>
                    <span className="what">
                      Anniversaire de {b.contact.name}
                      {b.age && <span className="meta">{b.age} ans</span>}
                    </span>
                  </li>
                ))}
                {life.toCall.map((c) => (
                  <li key={`c-${c.contact.id}`} className="card slot">
                    <span className="what">
                      Appeler {c.contact.name}
                      <span className="meta">{c.contact.relation ?? "proche"} · en retard de {c.lateDays} j</span>
                    </span>
                    <button onClick={() => act(() => api.contactCalled(c.contact.id))}>Appelé</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {life.care.length > 0 && <CareList care={life.care} act={act} />}
        </>
      )}
      <BudgetSection act={act} version={version} />
    </>
  );
}

export function CareList({ care, act, limit }: { care: LifeOverview["care"]; act: Act; limit?: number }) {
  return (
    <>
      <h2>Soins perso</h2>
      <ul className="list">
        {care.slice(0, limit).map((c) => (
          <li key={c.id} className="card slot">
            <span className="when">{longDate(c.nextOn)}</span>
            <span className="what">
              {c.name}
              <span className="meta">
                {c.kind === "produit" ? "à racheter" : "rendez-vous"} · tous les {c.everyDays} jours
              </span>
            </span>
            <button onClick={() => act(() => api.careDone(c.id))}>Fait</button>
          </li>
        ))}
      </ul>
    </>
  );
}

const MOMENT_LABEL: Record<string, string> = {
  matin: "le matin",
  midi: "le midi",
  soir: "le soir",
  avant_sport: "avant le sport",
  apres_sport: "après le sport",
};

/** Compléments du jour, à cocher d'un tap. */
export function Supplements({ life, act }: { life: LifeOverview; act: Act }) {
  if (life.supplementsToday.length === 0) return null;
  return (
    <li className="card health supplements">
      <strong>Compléments</strong>
      {life.supplementsToday.map((p) => (
        <div key={p.supplement.id} className="supplement-row">
          <span>
            {p.supplement.name}
            <span className="muted">
              {" "}
              · {MOMENT_LABEL[p.supplement.moment] ?? p.supplement.moment}
              {p.supplement.withMeal ? ", avec le repas" : ""}
            </span>
          </span>
          {p.takenAt ? (
            <span className="badge">Pris</span>
          ) : (
            <button onClick={() => act(() => api.supplementTaken(p.supplement.id))}>Pris</button>
          )}
        </div>
      ))}
    </li>
  );
}
