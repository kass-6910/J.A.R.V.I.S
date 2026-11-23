import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Liens signés pour les boutons des notifications (« Pris ») : ils transitent par ntfy,
 * donc jamais le jeton principal. Une signature ne vaut que pour son chemin exact.
 */
export function sign(path: string): string {
  return createHmac("sha256", `jarvis-action:${config.JARVIS_TOKEN}`).update(path).digest("base64url");
}

export function verify(path: string, signature: string): boolean {
  const expected = Buffer.from(sign(path));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** URL publique et signée d'une action, ou null si PUBLIC_URL n'est pas renseigné. */
export function actionUrl(path: string): string | null {
  if (!config.PUBLIC_URL) return null;
  return `${config.PUBLIC_URL.replace(/\/$/, "")}${path}?sig=${sign(path)}`;
}
