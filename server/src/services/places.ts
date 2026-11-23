import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db } from "../db/client.js";
import { locationEvents, places, workouts } from "../db/schema.js";
import { actionUrl } from "../lib/signing.js";
import { zone } from "../lib/time.js";
import { logWorkout } from "./health.js";
import { describeShop, shopStatus, type ShopSlug } from "./manageo.js";
import { replanToday } from "./planning.js";
import { NotFoundError } from "./tasks.js";

export type Place = typeof places.$inferSelect;
export type LocationEvent = typeof locationEvents.$inferSelect;

/** Lieux du cahier des charges, créés au premier démarrage (adresses à compléter). */
const DEFAULT_PLACES: (typeof places.$inferInsert)[] = [
  { slug: "salle", name: "Salle de sport", kind: "salle" },
  { slug: "lmdd-confluence", name: "LMDD Confluence", kind: "boutique", space: "lmdd-confluence" },
  { slug: "lmdd-croix-rousse", name: "LMDD Croix-Rousse", kind: "boutique", space: "lmdd-croix-rousse" },
  { slug: "ecole", name: "École", kind: "ecole", space: "ecole" },
  { slug: "maison", name: "Maison", kind: "maison" },
];

export async function ensureDefaultPlaces(): Promise<void> {
  await db.insert(places).values(DEFAULT_PLACES).onConflictDoNothing({ target: places.slug });
}

export async function listPlaces(): Promise<Place[]> {
  return db.select().from(places).orderBy(places.name);
}

export async function updatePlace(slug: string, patch: { name?: string; address?: string | null }): Promise<Place> {
  const [row] = await db.update(places).set(patch).where(eq(places.slug, slug)).returning();
  if (!row) throw new NotFoundError(`Lieu inconnu : ${slug}.`);
  return row;
}

export async function addPlace(input: { slug: string; name: string; kind: Place["kind"]; address?: string }): Promise<Place> {
  const [row] = await db.insert(places).values(input).returning();
  return row!;
}

const QUESTION: Record<Place["kind"], [string, string]> = {
  salle: ["Je suis là pour m'entraîner", "De passage"],
  boutique: ["Je suis là pour travailler", "De passage"],
  ecole: ["Je suis là pour les cours", "De passage"],
  maison: ["Je suis rentré", "De passage"],
  autre: ["J'y suis pour de bon", "De passage"],
};

/**
 * Arrivée ou départ signalé par l'iPhone. À l'arrivée, Jarvis demande confirmation :
 * rien ne change tant que Jessim n'a pas répondu « je suis là pour… ».
 */
export async function recordLocation(placeSlug: string, event: "arrivee" | "depart"): Promise<{ place: Place; event: LocationEvent }> {
  const place = await db.query.places.findFirst({ where: eq(places.slug, placeSlug) });
  if (!place) throw new NotFoundError(`Lieu inconnu : ${placeSlug}. Lieux enregistrés : ${(await listPlaces()).map((p) => p.slug).join(", ")}.`);

  if (event === "depart") {
    const [row] = await db.insert(locationEvents).values({ placeId: place.id, event, status: "recorded" }).returning();
    await closeVisit(place);
    return { place, event: row! };
  }

  const [row] = await db.insert(locationEvents).values({ placeId: place.id, event, status: "pending" }).returning();
  const [yes, no] = QUESTION[place.kind];
  const confirm = actionUrl(`/api/public/location/${row!.id}/present`);
  const passing = actionUrl(`/api/public/location/${row!.id}/passing`);
  if (isNotifyConfigured()) {
    await sendNotification({
      title: place.name,
      message: confirm ? "Tu arrives : tu restes ?" : "Tu arrives : confirme ta présence dans l'application.",
      priority: 3,
      tags: ["round_pushpin"],
      actions: confirm && passing ? [{ label: yes, url: confirm }, { label: no, url: passing }] : undefined,
    });
  }
  return { place, event: row! };
}

/**
 * Réponse à la question d'arrivée. « Présent » déclenche l'action du lieu :
 * séance démarrée à la salle, alertes de la boutique, journée recalée.
 */
export async function answerLocation(eventId: string, answer: "present" | "passing"): Promise<string> {
  const [row] = await db
    .update(locationEvents)
    .set({ status: answer, answeredAt: new Date() })
    .where(and(eq(locationEvents.id, eventId), eq(locationEvents.status, "pending")))
    .returning();
  if (!row) throw new NotFoundError("Cette arrivée a déjà reçu une réponse.");
  if (answer === "passing") return "De passage : rien ne change.";

  const place = (await db.query.places.findFirst({ where: eq(places.id, row.placeId) }))!;
  let message = `Présence confirmée : ${place.name}.`;
  if (place.kind === "salle") {
    const workout = await logWorkout({ type: "Salle de sport", endsAt: new Date(Date.now() + config.SPORT_DURATION_MIN * 60_000), minutes: config.SPORT_DURATION_MIN });
    await db.update(locationEvents).set({ workoutId: workout.id }).where(eq(locationEvents.id, row.id));
    message = "Séance démarrée. Bon entraînement !";
  }
  await replanToday();
  if (place.kind === "boutique" && place.space && isNotifyConfigured()) {
    const status = await shopStatus(place.space as ShopSlug);
    if (status) {
      await sendNotification({ title: place.name, message: describeShop(status).slice(1).join("\n"), priority: 3, tags: ["shopping_cart"] });
    }
  }
  return message;
}

/** Départ d'un lieu où Jessim était présent : la séance de la salle se termine maintenant. */
async function closeVisit(place: Place): Promise<void> {
  const visit = await db.query.locationEvents.findFirst({
    where: and(eq(locationEvents.placeId, place.id), eq(locationEvents.event, "arrivee"), eq(locationEvents.status, "present"), gte(locationEvents.at, new Date(Date.now() - 12 * 3600_000))),
    orderBy: desc(locationEvents.at),
  });
  if (!visit?.workoutId) return;
  const workout = await db.query.workouts.findFirst({ where: eq(workouts.id, visit.workoutId) });
  if (!workout) return;
  if (Date.now() - workout.startsAt.getTime() < MIN_SESSION_MS) {
    // Reparti presque aussitôt : ce n'était pas une séance, elle ne compte pas dans la semaine.
    await db.delete(workouts).where(eq(workouts.id, workout.id));
    await replanToday();
    return;
  }
  await db.update(workouts).set({ endsAt: new Date() }).where(eq(workouts.id, workout.id));
}

/** En dessous, une visite à la salle ne compte pas comme une séance. */
const MIN_SESSION_MS = 10 * 60_000;

/** Lieu où Jessim a confirmé être, s'il n'en est pas reparti depuis. */
export async function currentPlace(): Promise<{ place: Place; since: Date } | null> {
  const last = await db.query.locationEvents.findFirst({
    where: gte(locationEvents.at, new Date(Date.now() - 12 * 3600_000)),
    orderBy: desc(locationEvents.at),
  });
  if (!last || last.event !== "arrivee" || last.status !== "present") return null;
  const place = await db.query.places.findFirst({ where: eq(places.id, last.placeId) });
  return place ? { place, since: last.answeredAt ?? last.at } : null;
}

export async function describeCurrentPlace(): Promise<string | null> {
  const here = await currentPlace();
  if (!here) return null;
  return `Lieu actuel : ${here.place.name} (confirmé à ${DateTime.fromJSDate(here.since, { zone }).toFormat("HH:mm")}).`;
}

export async function pendingArrivals(): Promise<(LocationEvent & { place: Place })[]> {
  const rows = await db
    .select()
    .from(locationEvents)
    .innerJoin(places, eq(places.id, locationEvents.placeId))
    .where(and(eq(locationEvents.status, "pending"), gte(locationEvents.at, new Date(Date.now() - 60 * 60_000))))
    .orderBy(desc(locationEvents.at));
  return rows.map((r) => ({ ...r.location_events, place: r.places }));
}

