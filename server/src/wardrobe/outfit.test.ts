import { describe, expect, it } from "vitest";
import { parseOpenMeteo } from "../connectors/weather/openmeteo.js";
import { chooseOutfit, dayKind, wantedWarmth, type Garment } from "./outfit.js";

const g = (id: string, over: Partial<Garment>): Garment => ({
  id,
  type: "haut",
  label: id,
  color: "bleu",
  style: "decontracte",
  warmth: "moyen",
  rainProof: false,
  ...over,
});

const wardrobe: Garment[] = [
  g("chemise", { style: "smart" }),
  g("sweat", { warmth: "chaud" }),
  g("tshirt", { warmth: "leger" }),
  g("chino", { type: "bas", style: "smart" }),
  g("jean", { type: "bas" }),
  g("parka", { type: "veste", warmth: "chaud", rainProof: true }),
  g("blazer", { type: "veste", style: "smart" }),
  g("derbies", { type: "chaussures", style: "smart" }),
  g("baskets", { type: "chaussures" }),
  g("short-sport", { type: "tenue_sport", style: "sport" }),
];

const cold = { date: "2026-11-20", minC: 3, maxC: 9, rainChance: 70, summary: "pluie" };
const warm = { date: "2026-06-20", minC: 18, maxC: 29, rainChance: 0, summary: "ciel dégagé" };

describe("dayKind", () => {
  it("reconnaît un rendez-vous pro, puis les cours", () => {
    expect(dayKind(["Cours de gestion", "RDV fournisseur LMDD"])).toBe("pro");
    expect(dayKind(["TD de compta"])).toBe("ecole");
    expect(dayKind(["Dîner chez Yanis"])).toBe("libre");
  });
});

describe("chooseOutfit", () => {
  it("habille chaudement et contre la pluie un jour froid de cours", () => {
    const out = chooseOutfit({ wardrobe, weather: cold, kind: "ecole", sportToday: false, wornYesterday: new Set(), seed: 0 });
    expect(out.items.map((i) => i.id)).toEqual(["sweat", "jean", "parka", "baskets"]);
    expect(out.reason).toContain("pluie probable");
  });

  it("passe en tenue smart pour un rendez-vous pro, sans veste par temps chaud", () => {
    const out = chooseOutfit({ wardrobe, weather: warm, kind: "pro", sportToday: true, wornYesterday: new Set(), seed: 0 });
    expect(out.items.map((i) => i.id)).toEqual(["chemise", "chino", "derbies"]);
    expect(out.sportBag?.id).toBe("short-sport");
  });

  it("ne reprend pas un vêtement porté la veille", () => {
    const out = chooseOutfit({ wardrobe, weather: cold, kind: "ecole", sportToday: false, wornYesterday: new Set(["sweat", "jean"]), seed: 0 });
    expect(out.items.map((i) => i.id)).not.toContain("sweat");
    expect(out.items.map((i) => i.id)).toContain("chino");
  });

  it("propose autre chose quand Jessim demande une autre tenue", () => {
    const first = chooseOutfit({ wardrobe, weather: cold, kind: "ecole", sportToday: false, wornYesterday: new Set(), seed: 0 });
    const other = chooseOutfit({
      wardrobe,
      weather: cold,
      kind: "ecole",
      sportToday: false,
      wornYesterday: new Set(),
      seed: 0,
      avoid: new Set(first.items.map((i) => i.id)),
    });
    expect(other.items.map((i) => i.id)).not.toEqual(first.items.map((i) => i.id));
  });

  it("fait avec une garde-robe incomplète", () => {
    const out = chooseOutfit({ wardrobe: [g("tshirt", {})], weather: null, kind: "libre", sportToday: true, wornYesterday: new Set(), seed: 3 });
    expect(out.items.map((i) => i.id)).toEqual(["tshirt"]);
    expect(out.sportBag).toBeNull();
  });
});

describe("météo", () => {
  it("lit la réponse Open-Meteo et en déduit la chaleur voulue", () => {
    const w = parseOpenMeteo({
      daily: {
        time: ["2026-11-20"],
        temperature_2m_max: [9.4],
        temperature_2m_min: [2.6],
        precipitation_probability_max: [72],
        weather_code: [61],
      },
    });
    expect(w).toEqual({ date: "2026-11-20", minC: 3, maxC: 9, rainChance: 72, summary: "pluie" });
    expect(wantedWarmth(w)).toBe("chaud");
    expect(wantedWarmth(warm)).toBe("leger");
  });
});
