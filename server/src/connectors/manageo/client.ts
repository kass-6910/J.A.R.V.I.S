import { config } from "../../config.js";
import type {
  ManageoConsumption,
  ManageoPlanning,
  ManageoSalesDay,
  ManageoShop,
  ManageoStockItem,
} from "./types.js";

/** Client de l'API Jarvis de Manageo : lecture seule, clé dédiée et révocable (cahier des charges, §17). */

export function isManageoConfigured(): boolean {
  return Boolean(config.MANAGEO_URL && config.MANAGEO_API_KEY);
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`/api/jarvis/v1${path}`, config.MANAGEO_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.MANAGEO_API_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Manageo a répondu ${res.status} sur ${path} : ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export const manageo = {
  shops: () => get<{ boutiques: ManageoShop[] }>("/boutiques").then((r) => r.boutiques),
  stock: (shopId: number) => get<{ items: ManageoStockItem[] }>(`/boutiques/${shopId}/stock`).then((r) => r.items),
  consumption: (shopId: number, from: string, to: string) =>
    get<{ consommation: ManageoConsumption[] }>(`/boutiques/${shopId}/stock/consommation`, { from, to }).then(
      (r) => r.consommation,
    ),
  salesDay: (shopId: number, date: string) => get<ManageoSalesDay>(`/boutiques/${shopId}/ventes/jour`, { date }),
  planning: (shopId: number, weekStart: string) =>
    get<ManageoPlanning>(`/boutiques/${shopId}/planning`, { semaine: weekStart }),
};
