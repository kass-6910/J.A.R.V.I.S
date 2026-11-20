import type { DayWeather } from "../connectors/weather/openmeteo.js";

/** Choix de la tenue du jour : fonctions pures, testées à part. */

export const GARMENT_TYPES = ["haut", "bas", "veste", "chaussures", "tenue_sport", "accessoire"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];
export const STYLES = ["decontracte", "smart", "sport"] as const;
export type Style = (typeof STYLES)[number];
export const WARMTH = ["leger", "moyen", "chaud"] as const;
export type Warmth = (typeof WARMTH)[number];

export interface Garment {
  id: string;
  type: GarmentType;
  label: string;
  color: string;
  style: Style;
  warmth: Warmth;
  rainProof: boolean;
}

export type DayKind = "pro" | "ecole" | "libre";

const PRO = /\b(rdv|rendez-vous|réunion|reunion|entretien|banque|client|fournisseur|comptable|avocat|notaire|rendez vous|meeting)\b/i;
const SCHOOL = /\b(cours|td|tp|amphi|examen|partiel|soutenance|école|ecole)\b/i;

/** Type de journée d'après les titres de l'agenda : un rendez-vous pro l'emporte sur les cours. */
export function dayKind(eventTitles: string[]): DayKind {
  if (eventTitles.some((t) => PRO.test(t))) return "pro";
  if (eventTitles.some((t) => SCHOOL.test(t))) return "ecole";
  return "libre";
}

/** Chaleur voulue d'après la température ressentie de la journée (moyenne min / max). */
export function wantedWarmth(weather: DayWeather): Warmth {
  const mean = (weather.minC + weather.maxC) / 2;
  return mean < 10 ? "chaud" : mean < 18 ? "moyen" : "leger";
}

const WARMTH_RANK: Record<Warmth, number> = { leger: 0, moyen: 1, chaud: 2 };

function score(g: Garment, kind: DayKind, warmth: Warmth, rainy: boolean): number {
  const wantedStyle: Style = kind === "pro" ? "smart" : "decontracte";
  let s = 0;
  if (g.style === wantedStyle) s += 4;
  else if (g.style === "smart" || g.style === "decontracte") s += 1;
  s -= Math.abs(WARMTH_RANK[g.warmth] - WARMTH_RANK[warmth]) * 2;
  if (rainy && g.rainProof) s += 2;
  return s;
}

export interface Outfit {
  items: Garment[];
  /** Tenue de sport à mettre dans le sac. */
  sportBag: Garment | null;
  reason: string;
}

/**
 * Tenue du jour : un haut, un bas, des chaussures, une veste s'il fait frais ou qu'il pleut,
 * jamais un vêtement porté la veille. Les égalités se départagent par le jour (« seed »),
 * pour varier d'un jour à l'autre.
 */
export function chooseOutfit(input: {
  wardrobe: Garment[];
  weather: DayWeather | null;
  kind: DayKind;
  sportToday: boolean;
  wornYesterday: Set<string>;
  seed: number;
  /** Vêtements de la tenue précédente, quand Jessim en demande une autre : évités si possible. */
  avoid?: Set<string>;
}): Outfit {
  const weather = input.weather;
  const warmth = weather ? wantedWarmth(weather) : "moyen";
  const rainy = (weather?.rainChance ?? 0) >= 50;
  const available = input.wardrobe.filter((g) => !input.wornYesterday.has(g.id));

  const pick = (type: GarmentType): Garment | null => {
    const candidates = available.filter((g) => g.type === type);
    if (candidates.length === 0) return null;
    const ranked = candidates
      .map((g, i) => ({
        g,
        s: score(g, input.kind, warmth, rainy) - (input.avoid?.has(g.id) ? 3 : 0),
        tie: (i + input.seed) % candidates.length,
      }))
      .sort((a, b) => b.s - a.s || a.tie - b.tie);
    return ranked[0]!.g;
  };

  const needJacket = rainy || (weather ? weather.minC < 15 : true);
  const items = [pick("haut"), pick("bas"), needJacket ? pick("veste") : null, pick("chaussures")].filter(
    (g): g is Garment => g !== null,
  );
  const sportBag = input.sportToday ? pick("tenue_sport") : null;

  const parts: string[] = [];
  if (weather) parts.push(`${weather.minC} à ${weather.maxC} °C, ${rainy ? `pluie probable (${weather.rainChance} %)` : weather.summary}`);
  parts.push(input.kind === "pro" ? "rendez-vous pro" : input.kind === "ecole" ? "cours" : "journée libre");
  if (input.sportToday) parts.push("séance de sport");
  return { items, sportBag, reason: parts.join(", ") };
}
