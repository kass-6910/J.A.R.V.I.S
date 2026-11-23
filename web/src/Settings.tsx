import { useEffect, useState } from "react";
import { api, setToken, type PlacesInfo, type Settings as SettingsData, type UsageSummary } from "./api";
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
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    api.settings().then(setSettings, () => setSettings(null));
    api.places().then(setPlaces, () => setPlaces(null));
    api.usage().then(setUsage, () => setUsage(null));
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

      {usage && <ClaudeCredits usage={usage} />}

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

const dollars = (n: number) =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })} $`;

/** Crédits Claude consommés : estimation à partir des tokens de chaque appel. */
function ClaudeCredits({ usage }: { usage: UsageSummary }) {
  const max = Math.max(...usage.days.map((d) => d.usd), 0.0001);
  const share = usage.budget > 0 ? Math.min(usage.month / usage.budget, 1) : null;
  return (
    <>
      <h2>Crédits Claude</h2>
      <div className="card credits">
        <div className="credits-figures">
          <div>
            <span className="meta">Aujourd'hui</span>
            <strong>{dollars(usage.today)}</strong>
            <span className="meta">{usage.requestsToday} appel{usage.requestsToday > 1 ? "s" : ""}</span>
          </div>
          <div>
            <span className="meta">Ce mois-ci</span>
            <strong>{dollars(usage.month)}</strong>
            <span className="meta">fin de mois ≈ {dollars(usage.projection)}</span>
          </div>
          <div>
            <span className="meta">Mois dernier</span>
            <strong>{dollars(usage.lastMonth)}</strong>
          </div>
        </div>
        {share !== null && (
          <div className="credits-budget" aria-label="Part du plafond mensuel utilisée">
            <div className={`credits-bar${share >= 0.8 ? " warn" : ""}`} style={{ width: `${share * 100}%` }} />
            <span className="meta">
              {Math.round(share * 100)} % du plafond de {dollars(usage.budget)}
            </span>
          </div>
        )}
        {usage.days.length > 0 && (
          <div className="credits-days" aria-label="Dépense des 30 derniers jours">
            {usage.days.map((d) => (
              <i key={d.day} title={`${d.day} : ${dollars(d.usd)}`} style={{ height: `${Math.max((d.usd / max) * 100, 4)}%` }} />
            ))}
          </div>
        )}
        <ul className="credits-features">
          {usage.byFeature.map((f) => (
            <li key={f.feature}>
              <span>{f.label}</span>
              <span className="muted">
                {f.requests} · {dollars(f.usd)}
              </span>
            </li>
          ))}
        </ul>
        <p className="meta">
          Estimation d'après les tokens de chaque appel. La facture exacte et le solde sont sur{" "}
          <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">
            la console Claude
          </a>
          .
        </p>
      </div>
    </>
  );
}
