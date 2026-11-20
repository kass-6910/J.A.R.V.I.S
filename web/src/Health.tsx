import { useEffect, useState } from "react";
import { api, type DayPlan, type HealthSummary, type LifeOverview, type MealPlan, type PrayerInfo } from "./api";
import type { Act } from "./components";
import { CareList, Supplements } from "./Life";

const SLOT_LABEL = { matin: "Petit-déjeuner", midi: "Déjeuner", collation: "Collation", soir: "Dîner" } as const;
const SLOT_ORDER = ["matin", "midi", "collation", "soir"];

const PRAYER_LABEL = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" } as const;

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function sleepText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Écran Santé : nuit, sport de la semaine, activité, prochaine prière. */
export function Health({
  plan,
  prayer,
  act,
  version,
}: {
  plan: DayPlan;
  prayer: PrayerInfo;
  act: Act;
  version: unknown;
}) {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [life, setLife] = useState<LifeOverview | null>(null);
  const [meals, setMeals] = useState<{ meals: MealPlan[]; target: { kcal: number; sportToday: boolean } } | null>(null);
  const [showWeek, setShowWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.healthSummary().then(setSummary, (err: Error) => setError(err.message));
    api.life().then(setLife, () => setLife(null));
    api.meals().then(setMeals, () => setMeals(null));
  }, [version]);

  if (error) return <p className="banner critical">{error}</p>;
  if (!summary) return <p className="muted">Chargement…</p>;

  const { lastNight, yesterday, week } = summary;
  const sport = plan.blocks.find((b) => b.kind === "sport" && new Date(b.endsAt).getTime() > Date.now());
  const nextPrayer = prayer.times
    ? (Object.entries(prayer.times) as [keyof typeof PRAYER_LABEL, string][]).find(
        ([, at]) => new Date(at).getTime() > Date.now(),
      )
    : undefined;
  const noData = !lastNight && !yesterday && week.done === 0;
  const nextMeal = plan.blocks.find((b) => b.kind === "meal" && new Date(b.endsAt).getTime() > Date.now());
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const nextMenu = nextMeal
    ? meals?.meals.find((m) => m.day === today && nextMeal.title.startsWith(SLOT_LABEL[m.slot]))
    : undefined;

  return (
    <>
      <header>
        <h1>Santé</h1>
        <p className="muted">Synchronisé avec l'Apple Watch</p>
      </header>

      {noData && <p className="banner">Aucune donnée de la montre reçue pour l'instant.</p>}

      <ul className="list">
        <li className="card health sleep">
          <strong>Sommeil</strong>
          {lastNight?.sleepMin ? (
            <p>
              {sleepText(lastNight.sleepMin)} cette nuit
              {lastNight.sleepStart && lastNight.sleepEnd && (
                <span className="muted">
                  {" "}
                  · {hm(lastNight.sleepStart)} → {hm(lastNight.sleepEnd)}
                </span>
              )}
            </p>
          ) : (
            <p className="muted">Nuit pas encore reçue.</p>
          )}
        </li>

        <li className="card health sport">
          <strong>
            Sport · {week.target} séance{week.target > 1 ? "s" : ""} par semaine
          </strong>
          <div className="dots" role="img" aria-label={`${week.done} séance(s) faite(s) sur ${week.target}`}>
            {Array.from({ length: week.target }, (_, i) => (
              <i key={i} className={i < week.done ? "on" : ""} />
            ))}
            <span className="muted">
              {week.doneToday
                ? "Séance du jour faite"
                : sport
                  ? `${sport.title} à ${hm(sport.startsAt)}`
                  : week.done >= week.target
                    ? "Objectif atteint"
                    : "Repos aujourd'hui"}
            </span>
          </div>
          {!week.doneToday && (
            <div className="row">
              <button onClick={() => act(() => api.logWorkout())}>Séance faite</button>
            </div>
          )}
        </li>

        <li className="card health activity">
          <strong>Activité d'hier</strong>
          {yesterday?.steps != null ? (
            <p>
              {yesterday.steps.toLocaleString("fr-FR")} pas
              {yesterday.activeKcal != null && <span className="muted"> · {yesterday.activeKcal} kcal actives</span>}
            </p>
          ) : (
            <p className="muted">Pas encore reçue.</p>
          )}
        </li>

        {meals && meals.meals.length > 0 && (
          <li className="card health meal">
            <strong>Prochain repas</strong>
            {nextMeal ? (
              <p>
                {nextMeal.title}
                <span className="muted"> · {hm(nextMeal.startsAt)}</span>
              </p>
            ) : (
              <p className="muted">Plus de repas prévu aujourd'hui.</p>
            )}
            {nextMenu && <p className="muted">{nextMenu.description}</p>}
            <p className="muted">
              Objectif du jour : {meals.target.kcal.toLocaleString("fr-FR")} kcal{meals.target.sportToday ? " (jour de sport)" : ""}
            </p>
            <div className="row">
              <button onClick={() => setShowWeek(!showWeek)}>{showWeek ? "Masquer la semaine" : "Menus de la semaine"}</button>
            </div>
            {showWeek && (
              <ul className="week-menu">
                {[...new Set(meals.meals.map((m) => m.day))].map((day) => (
                  <li key={day}>
                    <span className="title">
                      {new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}
                    </span>
                    {meals.meals
                      .filter((m) => m.day === day)
                      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
                      .map((m) => (
                        <span key={m.id} className="muted">
                          {SLOT_LABEL[m.slot]} : {m.title}
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}

        {life && <Supplements life={life} act={act} />}

        {prayer.enabled && (
          <li className="card health prayer-card">
            <strong>Prochaine prière</strong>
            <p>
              {nextPrayer ? `${PRAYER_LABEL[nextPrayer[0]]} à ${hm(nextPrayer[1])}` : "Plus de prière aujourd'hui"}
              <span className="muted"> · créneau protégé</span>
            </p>
          </li>
        )}
      </ul>
      {life && life.care.length > 0 && <CareList care={life.care} act={act} limit={3} />}
      <p className="muted footnote">Bilan de la semaine chaque dimanche soir.</p>
    </>
  );
}
