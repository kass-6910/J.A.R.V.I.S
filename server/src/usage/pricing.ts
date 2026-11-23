/**
 * Coût d'un appel à Claude, en dollars, d'après les tokens renvoyés par l'API.
 * Fonctions pures : pas de base, pas d'horloge.
 *
 * Tarifs publics par million de tokens (novembre 2026). L'écriture en cache coûte 1,25 fois l'entrée,
 * sa lecture environ 0,1 fois. C'est une estimation : la facture exacte reste celle de la console Claude.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Un modèle inconnu est compté au tarif de Sonnet, pour ne pas sous-estimer. */
export function priceOf(model: string): ModelPrice {
  const known = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((id) => model === id || model.startsWith(`${id}-`));
  return PRICES[known ?? "claude-sonnet-5-5"]!;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Coût en micro-dollars (millionièmes de dollar), arrondi à l'entier. */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  const p = priceOf(model);
  // Prix par million de tokens × tokens = micro-dollars.
  return Math.round(
    usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite,
  );
}

/** Projection de fin de mois : dépense actuelle étalée sur les jours écoulés. */
export function projectMonth(spentMicro: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0) return spentMicro;
  return Math.round((spentMicro / dayOfMonth) * daysInMonth);
}

/** Seuils d'alerte franchis (en % du plafond), du plus haut au plus bas. */
export function crossedThresholds(spentMicro: number, budgetUsd: number): number[] {
  if (budgetUsd <= 0) return [];
  const ratio = spentMicro / (budgetUsd * 1_000_000);
  return [100, 80].filter((t) => ratio >= t / 100);
}
