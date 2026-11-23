import { config } from "../../config.js";
import { parseRouteDuration, type TravelMode } from "../../travel/rules.js";

/** Temps de trajet par l'API Routes de Google Maps, trafic en temps réel compris. */

export function isMapsConfigured(): boolean {
  return Boolean(config.GOOGLE_MAPS_API_KEY);
}

export async function travelMinutes(origin: string, destination: string, mode: TravelMode, arriveBy: Date): Promise<number> {
  const body: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: mode,
    languageCode: "fr",
    units: "METRIC",
  };
  if (mode === "DRIVE") {
    body.routingPreference = "TRAFFIC_AWARE";
    // L'API refuse une heure de départ dans le passé : on part « maintenant » si besoin.
    const departure = new Date(Math.max(Date.now() + 60_000, arriveBy.getTime() - 3600_000));
    body.departureTime = departure.toISOString();
  } else {
    body.arrivalTime = arriveBy.toISOString();
  }
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.duration",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Maps a répondu ${res.status} : ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { routes?: { duration: string }[] };
  const route = data.routes?.[0];
  if (!route) throw new Error("Aucun itinéraire trouvé.");
  return parseRouteDuration(route.duration);
}
