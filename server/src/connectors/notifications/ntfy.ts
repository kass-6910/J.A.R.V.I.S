import { config } from "../../config.js";

export interface Notification {
  title: string;
  message: string;
  /** 1 (discret) à 5 (urgent, sonne même en mode concentration selon les réglages de ntfy). */
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  /** Boutons de la notification : chacun envoie un POST à son adresse (lien signé). */
  actions?: { label: string; url: string }[];
}

export function isNotifyConfigured(): boolean {
  return config.NTFY_TOPIC !== "";
}

/**
 * Envoie une notification push via ntfy (appli ntfy sur l'iPhone, abonnée au sujet NTFY_TOPIC).
 * La publication passe en JSON : les titres accentués ne passent pas dans les en-têtes HTTP.
 */
export async function sendNotification(n: Notification): Promise<void> {
  if (!isNotifyConfigured()) throw new Error("Les notifications ne sont pas configurées (NTFY_TOPIC vide).");
  const res = await fetch(config.NTFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.NTFY_TOKEN && { Authorization: `Bearer ${config.NTFY_TOKEN}` }),
    },
    body: JSON.stringify({
      topic: config.NTFY_TOPIC,
      title: n.title,
      // ntfy coupe les messages au-delà de 4 096 octets.
      message: n.message.slice(0, 3800),
      priority: n.priority ?? 3,
      tags: n.tags,
      ...(n.actions?.length && {
        actions: n.actions.map((a) => ({ action: "http", label: a.label, url: a.url, method: "POST", clear: true })),
      }),
      ...(config.PUBLIC_URL && { click: config.PUBLIC_URL }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy a répondu ${res.status} : ${await res.text()}`);
}
