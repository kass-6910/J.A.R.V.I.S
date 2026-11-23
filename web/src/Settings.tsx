import { useEffect, useState } from "react";
import { api, setToken, type PlacesInfo, type Settings as SettingsData } from "./api";
import type { Act } from "./components";

const STATUS_LABEL = { connected: "Connecté", partial: "Partiel", missing: "Non connecté" } as const;
const PRAYER_METHOD: Record<number, string> = { 12: "UOIF (France)", 3: "Ligue islamique mondiale", 2: "ISNA", 4: "Umm al-Qura" };

function PlaceAddress({ place, act }: { place: PlacesInfo["places"][number]; act: Act }) {
  const [value, setValue] = useState(place.address ?? "");
  const [editing, setEditing] = useState(false);
  return (
    <li className="card settings-row place">
      <span className="what">
        {place.name}
        {editing ? (
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Adresse" aria-label={`Adresse de ${place.name}`} autoFocus />
        ) : (
          <span className="meta">{place.address ?? "Adresse non renseignée"}</span>
        )}
      </span>
      {editing ? (
        <button
          className="primary"
          onClick={async () => {
            await act(() => api.setPlaceAddress(place.slug, value.trim()));
            setEditing(false);
          }}
          disabled={!value.trim()}
        >
          OK
        </button>
      ) : (
        <button onClick={() => setEditing(true)}>Modifier</button>
      )}
    </li>
  );
}

/** Écran Réglages : connexions, lieux enregistrés et préférences. */
export function Settings({ act, version, onLogout }: { act: Act; version: unknown; onLogout: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [places, setPlaces] = useState<PlacesInfo | null>(null);

  useEffect(() => {
    api.settings().then(setSettings, () => setSettings(null));
    api.places().then(setPlaces, () => setPlaces(null));
  }, [version]);

  if (!settings) return <p className="muted">Chargement…</p>;
  const p = settings.preferences;
  const prefs: [string, string][] = [
    ["Briefing du matin", p.briefingTime],
    ["Bilan du soir", p.eveningTime],
    ["Horaires de prière", p.prayerMethod === null ? "Désactivés" : (PRAYER_METHOD[p.prayerMethod] ?? `Méthode ${p.prayerMethod}`)],
    ["Sport", `${p.sportPerWeek} séances par semaine`],
    ["Objectif repas", `${p.mealKcal.toLocaleString("fr-FR")} kcal par jour`],
    ["Plafond budget", p.budgetMonthlyEur > 0 ? `${p.budgetMonthlyEur.toLocaleString("fr-FR")} € par mois` : "Aucun"],
    ["Trajets", p.travelMode === "TRANSIT" ? "Transports en commun (TCL)" : "Voiture"],
  ];

  return (
    <>
      <header>
        <h1>Réglages</h1>
        <p className="muted">Tout se règle aussi à la voix</p>
      </header>

      <h2>Connexions</h2>
      <ul className="list">
        {settings.connections.map((c) => (
          <li key={c.key} className="card settings-row">
            <span className="what">
              {c.label}
              {c.detail && <span className="meta">{c.detail}</span>}
            </span>
            <span className={`status ${c.status}`}>
              <i />
              {STATUS_LABEL[c.status]}
            </span>
          </li>
        ))}
      </ul>

      <h2>Lieux enregistrés</h2>
      {places && (
        <ul className="list">
          {places.places.map((place) => (
            <PlaceAddress key={place.id} place={place} act={act} />
          ))}
        </ul>
      )}

      <h2>Préférences</h2>
      <ul className="list">
        {prefs.map(([label, value]) => (
          <li key={label} className="card settings-row">
            <span className="what">{label}</span>
            <span className="muted">{value}</span>
          </li>
        ))}
      </ul>
      <p className="accent-note">Envois, paiements, commandes et suppressions : toujours validés par toi.</p>

      <button
        className="logout"
        onClick={() => {
          setToken(null);
          onLogout();
        }}
      >
        Déconnecter cet appareil
      </button>
    </>
  );
}
