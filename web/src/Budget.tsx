import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { api, type Budget } from "./api";
import type { Act } from "./components";

const CATEGORIES: [string, string][] = [
  ["alimentation", "Alimentation"],
  ["restaurants", "Restaurants"],
  ["transport", "Transport"],
  ["logement", "Logement"],
  ["sante", "Santé"],
  ["vetements", "Vêtements"],
  ["loisirs", "Loisirs"],
  ["etudes", "Études"],
  ["cadeaux", "Cadeaux"],
  ["autre", "Autre"],
];

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

/** Réduit une photo (1600 px au plus, JPEG) avant l'envoi. */
export async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
}

export function BudgetSection({ act, version }: { act: Act; version: unknown }) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("alimentation");
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.budget().then(setBudget, () => setBudget(null));
  }, [version]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!amount.trim() || !label.trim()) return;
    await act(() => api.addExpense(amount, label, category));
    setAmount("");
    setLabel("");
  }

  async function photo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true);
    setMessage(null);
    try {
      const expense = await api.addReceipt(await shrink(file), "image/jpeg");
      setMessage(`Facture lue : ${expense.label}, ${euros(expense.amountCents)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Facture illisible.");
    }
    setReading(false);
    await act(async () => undefined);
  }

  if (!budget) return null;
  const { status } = budget;
  const ratio = status.limit > 0 ? Math.min(1, status.spent / status.limit) : 0;

  return (
    <>
      <h2>Budget du mois</h2>
      <div className="card budget">
        <div className="kpi">
          <span className="kpi-value">{euros(status.spent)}</span>
          <span className="muted">
            {status.limit > 0 ? `sur ${euros(status.limit)} · ` : ""}projection fin de mois {euros(status.projected)}
          </span>
        </div>
        {status.limit > 0 && (
          <div className="bar" role="img" aria-label={`${Math.round(ratio * 100)} % du budget`}>
            <i className={status.level === 100 ? "over" : status.level === 80 ? "warn" : ""} style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
        {budget.byCategory.length > 0 && (
          <ul className="stock-lines">
            {budget.byCategory.map((c) => (
              <li key={c.category}>
                <span>{c.label}</span>
                <span className="muted">{euros(c.cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <label className={`button-like ${reading ? "disabled" : ""}`}>
          {reading ? "Lecture de la facture…" : "Facture en photo"}
          <input type="file" accept="image/*" capture="environment" onChange={photo} disabled={reading} hidden />
        </label>
        {message && <p className="muted">{message}</p>}
      </div>

      <form className="card add" onSubmit={add}>
        <div className="row">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Montant"
            inputMode="decimal"
            aria-label="Montant en euros"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
            {CATEGORIES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé" aria-label="Libellé de la dépense" />
        <button className="primary" type="submit" disabled={!amount.trim() || !label.trim()}>
          Ajouter la dépense
        </button>
      </form>

      {budget.expenses.length > 0 && (
        <ul className="list">
          {budget.expenses.slice(0, 8).map((e) => (
            <li key={e.id} className="card slot expense">
              <span className="when">{new Date(`${e.spentOn}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              <span className="what">
                {e.label}
                <span className="meta">
                  {e.source === "abonnement"
                    ? "Abonnement"
                    : e.space === "vie-perso"
                      ? (CATEGORIES.find(([v]) => v === e.category)?.[1] ?? e.category)
                      : "Pro"}
                  {e.source === "photo" && " · facture"}
                </span>
              </span>
              <span className="amount">{euros(e.amountCents)}</span>
              <button className="ghost" aria-label={`Supprimer ${e.label}`} onClick={() => window.confirm(`Supprimer « ${e.label} » ?`) && act(() => api.removeExpense(e.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {budget.subscriptions.length > 0 && (
        <p className="muted footnote">
          Abonnements : {budget.subscriptions.map((s) => `${s.name} ${euros(s.amountCents)} le ${s.dayOfMonth}`).join(" · ")}
        </p>
      )}
    </>
  );
}
