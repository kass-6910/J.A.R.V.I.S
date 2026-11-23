import { type ChangeEvent, useEffect, useState } from "react";
import { api, authedImage, type Garment, type TodayOutfit } from "./api";
import { shrink } from "./Budget";
import type { Act } from "./components";

const TYPE_LABEL: Record<string, string> = {
  haut: "Hauts",
  bas: "Bas",
  veste: "Vestes",
  chaussures: "Chaussures",
  tenue_sport: "Sport",
  accessoire: "Accessoires",
};

function Photo({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    authedImage(`/wardrobe/${id}/photo`).then(
      (u) => {
        url = u;
        setSrc(u);
      },
      () => setSrc(null),
    );
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? <img src={src} alt={alt} /> : <span className="photo-placeholder" aria-label={alt} />;
}

export function Wardrobe({ act, version }: { act: Act; version: unknown }) {
  const [data, setData] = useState<{ items: Garment[]; outfit: TodayOutfit | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.wardrobe().then(setData, () => setData(null));
  }, [version]);

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setAdding(true);
    setMessage(null);
    const added: string[] = [];
    for (const file of files) {
      try {
        added.push((await api.addGarment(await shrink(file), "image/jpeg")).label);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Vêtement non reconnu.");
      }
    }
    if (added.length > 0) setMessage(`Ajouté : ${added.join(", ")}.`);
    setAdding(false);
    await act(async () => undefined);
  }

  if (!data) return null;
  const { outfit, items } = data;

  return (
    <>
      <h2>Garde-robe</h2>
      {outfit && (
        <div className="card outfit">
          <strong>Tenue du jour</strong>
          <p className="muted">{outfit.reason}</p>
          <div className="photos">
            {outfit.items.map((g) => (
              <figure key={g.id}>
                <Photo id={g.id} alt={g.label} />
                <figcaption>{g.label}</figcaption>
              </figure>
            ))}
          </div>
          {outfit.sportBag && <p className="muted">Dans le sac : {outfit.sportBag.label}</p>}
          <div className="row">
            <button onClick={() => act(() => api.otherOutfit())}>Autre tenue</button>
          </div>
        </div>
      )}
      <label className={`button-like ${adding ? "disabled" : ""}`}>
        {adding ? "Analyse des photos…" : "Ajouter des vêtements en photo"}
        <input type="file" accept="image/*" multiple onChange={add} disabled={adding} hidden />
      </label>
      {message && <p className="muted">{message}</p>}
      {items.length === 0 ? (
        <p className="muted">Une photo par vêtement : Jarvis le reconnaît et propose une tenue chaque matin.</p>
      ) : (
        Object.entries(TYPE_LABEL).map(([type, label]) => {
          const list = items.filter((i) => i.type === type);
          if (list.length === 0) return null;
          return (
            <div key={type}>
              <h3 className="subhead">{label}</h3>
              <div className="photos grid">
                {list.map((g) => (
                  <figure key={g.id}>
                    <Photo id={g.id} alt={g.label} />
                    <figcaption>
                      {g.label}
                      <button
                        className="ghost small"
                        aria-label={`Retirer ${g.label}`}
                        onClick={() => window.confirm(`Retirer « ${g.label} » de la garde-robe ?`) && act(() => api.removeGarment(g.id))}
                      >
                        ✕
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
