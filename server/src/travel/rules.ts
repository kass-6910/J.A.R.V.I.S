/** Trajets : fonctions pures, testées à part. */

export type TravelMode = "TRANSIT" | "DRIVE";

/** Heure de départ : début du rendez-vous moins le trajet et une marge. */
export function departureAt(eventStartMs: number, travelMin: number, bufferMin: number): number {
  return eventStartMs - (travelMin + bufferMin) * 60_000;
}

/**
 * Faut-il envoyer « pars maintenant » ? Dans les 5 minutes qui précèdent l'heure de départ,
 * et jusqu'au début du rendez-vous (rattrapage si le serveur était occupé).
 */
export function shouldAlertDeparture(nowMs: number, departureMs: number, eventStartMs: number): boolean {
  return nowMs >= departureMs - 5 * 60_000 && nowMs < eventStartMs;
}

/** Quand recalculer le trajet : une première fois 3 h avant, puis toutes les 15 min dans l'heure qui précède. */
export function shouldRefreshTravel(nowMs: number, eventStartMs: number, lastComputedMs: number | null): boolean {
  const before = eventStartMs - nowMs;
  if (before <= 0 || before > 3 * 3600_000) return false;
  if (lastComputedMs === null) return true;
  return before <= 3600_000 && nowMs - lastComputedMs >= 15 * 60_000;
}

/** Durée de l'API Routes (« 1534s ») en minutes, arrondie au-dessus. */
export function parseRouteDuration(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) throw new Error(`Durée illisible : ${value}`);
  return Math.ceil(Number(match[1]) / 60);
}

export function googleMapsUrl(destination: string, mode: TravelMode): string {
  const params = new URLSearchParams({ api: "1", destination, travelmode: mode === "TRANSIT" ? "transit" : "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}

export function wazeUrl(destination: string): string {
  return `https://waze.com/ul?${new URLSearchParams({ q: destination, navigate: "yes" })}`;
}
