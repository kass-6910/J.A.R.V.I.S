/**
 * Format des réponses de l'API Jarvis de Manageo (voir docs/manageo-api.md).
 * Les montants sont en euros, les dates au format AAAA-MM-JJ et les heures HH:MM (heure de Paris).
 */

export interface ManageoShop {
  id: number;
  slug: string;
  name: string;
  city: string | null;
}

export interface ManageoStockItem {
  id: number;
  name: string;
  category: string | null;
  unit: string | null;
  qty: number;
  min_qty: number | null;
  stock_alerte: number | null;
  stock_securite: number | null;
  stock_maximum: number | null;
  supplier: { id: number; name: string } | null;
}

/** Quantité consommée (ventes, en unité de stock) par article et par jour. */
export interface ManageoConsumption {
  stock_item_id: number;
  day: string;
  qty: number;
}

export interface ManageoSalesDay {
  date: string;
  /** Chiffre d'affaires des commandes valides du jour (même définition que les statistiques de Manageo). */
  ca: number;
  ca_encaisse: number;
  commandes: number;
}

export interface ManageoPlanning {
  week_start: string;
  published: boolean;
  /** Heures d'ouverture de la boutique, jour par jour. */
  ouverture: { date: string; start: string; end: string }[];
  shifts: { user_id: number; name: string; date: string; start: string; end: string; lieu: string | null }[];
  absences: { user_id: number; name: string; date: string; type: string }[];
  disponibilites: { user_id: number; name: string; date: string; start: string; end: string }[];
  employes: { id: number; name: string; position: string | null; weekly_hours: number | null }[];
}
