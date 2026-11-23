import { describe, expect, it } from "vitest";
import { costMicroUsd, crossedThresholds, priceOf, projectMonth } from "./pricing.js";

describe("coût des appels à Claude", () => {
  it("compte entrée, sortie et cache au tarif du modèle", () => {
    // Sonnet 5.5 : 1 000 × 2 + 200 × 10 + 15 000 × 0,1 + 0 = 5 500 micro-dollars.
    expect(
      costMicroUsd("claude-sonnet-5-5", {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 15000,
        cache_creation_input_tokens: null,
      }),
    ).toBe(5500);
  });

  it("Haiku coûte vingt fois moins que Sonnet", () => {
    const usage = { input_tokens: 2000, output_tokens: 300 };
    expect(costMicroUsd("claude-haiku-5-5", usage) * 20).toBe(costMicroUsd("claude-sonnet-5-5", usage));
  });

  it("reconnaît un identifiant daté et compte un modèle inconnu au tarif de Sonnet", () => {
    expect(priceOf("claude-haiku-5-5-20261001").input).toBe(0.1);
    expect(priceOf("claude-sonnet-5").cacheRead).toBe(0.2);
    expect(priceOf("modele-inconnu").input).toBe(2);
  });

  it("projette la fin du mois et signale les seuils franchis", () => {
    expect(projectMonth(3_000_000, 10, 30)).toBe(9_000_000);
    expect(crossedThresholds(4_000_000, 5)).toEqual([80]);
    expect(crossedThresholds(5_000_000, 5)).toEqual([100, 80]);
    expect(crossedThresholds(5_000_000, 0)).toEqual([]);
  });
});
