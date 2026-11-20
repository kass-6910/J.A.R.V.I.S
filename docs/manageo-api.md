# API Jarvis de Manageo : spécification

Jarvis lit les données des boutiques LMDD dans Manageo par une API dédiée. Ce document décrit ce que Manageo doit exposer. Le connecteur de Jarvis (`server/src/connectors/manageo/`) est écrit d'après ce contrat ; ses types sont dans `server/src/connectors/manageo/types.ts`.

Principes (cahier des charges, §17) :

- **Lecture seule.** Seules des routes `GET`. La seule écriture prévue plus tard est la création d'un bon de commande en brouillon (voir la fin).
- **Jamais d'accès direct à la base de production** depuis Jarvis : tout passe par cette API.
- **Clé dédiée, révocable à tout moment**, limitée aux boutiques LMDD.

Les références de fichiers renvoient au dépôt Manageo tel qu'il était le 18 novembre 2026 (commit `f6d7210`).

## Authentification

Calquée sur la clé de l'agent d'impression (`backend/services/printAgentService.js`, table `print_agents`) :

- Clé au format `mgj_` suivi de 24 octets aléatoires en base64url, affichée une seule fois à la création.
- Seul le SHA-256 est stocké. Nouvelle table :

  | Colonne | Rôle |
  |---|---|
  | `id` | identifiant |
  | `key_hash` | SHA-256 de la clé |
  | `key_hint` | 4 derniers caractères, pour la reconnaître dans l'interface |
  | `entreprise_ids` | boutiques autorisées (ids de `entreprises`) |
  | `created_at`, `last_used_at`, `revoked_at` | suivi et révocation |

- Envoyée par Jarvis en `Authorization: Bearer mgj_…`.
- Middleware `authenticateJarvisKey` :
  - refuse toute méthode autre que `GET` ;
  - refuse une clé révoquée ;
  - refuse une boutique absente de `entreprise_ids` (403) ;
  - met à jour `last_used_at`.
- Les routes vivent dans un nouveau fichier `backend/routes/jarvis.routes.js` (`registerJarvis(app)`), enregistré dans `backend/server.js` comme les autres. Elles n'utilisent ni `authenticateJWT` ni `checkEntrepriseAccess` : un jeton utilisateur ne voit qu'une boutique à la fois, alors que la clé Jarvis en couvre deux.

Préfixe de toutes les routes : `/api/jarvis/v1`. Dates au format `AAAA-MM-JJ`, heures `HH:MM`, heure de Paris (le serveur et la base sont déjà forcés sur `Europe/Paris`). Montants en euros, nombres décimaux.

## `GET /boutiques`

Les boutiques autorisées pour la clé.

```json
{ "boutiques": [ { "id": 12, "slug": "lmdd-confluence", "name": "LMDD Confluence", "city": "Lyon" } ] }
```

Source : `entreprises` (`id`, `slug`, `name`, `city`), filtrée sur `entreprise_ids`.

Jarvis reconnaît les boutiques par leur slug : `lmdd-confluence` et `lmdd-croix-rousse`. Manageo génère ce slug à partir du nom (`schema.js:299-342`). Si les slugs réels diffèrent, Jarvis peut recevoir la correspondance par sa variable `MANAGEO_SHOPS` (`lmdd-confluence:12,lmdd-croix-rousse:14`).

## `GET /boutiques/:id/stock`

Le stock de la boutique (pas celui du dépôt central).

```json
{
  "items": [
    {
      "id": 301, "name": "Lait demi-écrémé", "category": "Crèmerie", "unit": "L",
      "qty": 4, "min_qty": 2, "stock_alerte": 6, "stock_securite": 4, "stock_maximum": 24,
      "supplier": { "id": 7, "name": "Laiterie Dumont" }
    }
  ]
}
```

Source : `stock_items` (`schema.js:414-470`) joint à `suppliers` sur `supplier_id`, `WHERE entreprise_id = :id AND NOT is_hidden AND NOT is_produced`. C'est le même filtre que `GET /stock/low` (`stock.routes.js:52-75`).

Jarvis applique la règle du backend :
- seuil = `stock_alerte` s'il est renseigné, sinon `min_qty` ;
- un stock à zéro est toujours signalé ;
- cible de réassort = `stock_maximum`, sinon deux fois le seuil (règle de `stockRules.js`).

**Données à remplir dans Manageo** : un seuil pour chaque article, et un fournisseur, pour que les bons de commande soient regroupés correctement.

## `GET /boutiques/:id/stock/consommation?from=AAAA-MM-JJ&to=AAAA-MM-JJ`

Quantité vendue par article et par jour, en unité de stock. Sert à prévoir les ruptures (« plus de lait dans 3 jours »). `to` est exclu.

```json
{ "consommation": [ { "stock_item_id": 301, "day": "2026-11-19", "qty": 3.5 } ] }
```

Source : `stock_movements` (`schema.js:609-629`), mouvements de type `consommation` créés à chaque vente via `menu_item_stock_links` (`commandes.routes.js:713`).

```sql
SELECT stock_item_id, DATE(created_at) AS day, -SUM(delta) AS qty
FROM stock_movements
WHERE entreprise_id = :id AND type = 'consommation'
  AND created_at >= :from AND created_at < :to
GROUP BY stock_item_id, DATE(created_at)
```

Jarvis moyenne sur les quatorze derniers jours, en comptant à zéro les jours sans vente.

## `GET /boutiques/:id/ventes/jour?date=AAAA-MM-JJ`

Chiffre d'affaires d'un jour. Jarvis demande la veille et le même jour de la semaine précédente, pour comparer.

```json
{ "date": "2026-11-19", "ca": 1243.5, "ca_encaisse": 1198.0, "commandes": 87 }
```

Source : même définition que les statistiques de Manageo (`statistiques.routes.js:22` et `147-187`).

```sql
SELECT COALESCE(SUM(total_amount), 0) AS ca,
       COALESCE(SUM(total_amount) FILTER (WHERE paid_at IS NOT NULL), 0) AS ca_encaisse,
       COUNT(*) AS commandes
FROM orders
WHERE entreprise_id = :id AND supplier_id IS NULL AND order_date = :date
  AND status IN ('delivered','confirmed','ready','preparing','pending','ordered')
```

**Convention à confirmer** : `total_amount` correspond aux prix de la carte, donc TTC en pratique, mais `finances.routes.js:250-278` le traite comme HT. Jarvis l'affiche sans mention HT ou TTC tant que ce point n'est pas tranché.

## `GET /boutiques/:id/planning?semaine=AAAA-MM-JJ`

Le planning de l'équipe pour la semaine qui commence ce lundi-là, déjà mis à plat par Manageo.

```json
{
  "week_start": "2026-11-16",
  "published": true,
  "ouverture": [ { "date": "2026-11-20", "start": "08:00", "end": "20:00" } ],
  "shifts": [ { "user_id": 3, "name": "Amel", "date": "2026-11-20", "start": "08:00", "end": "14:00", "lieu": "Principal" } ],
  "absences": [ { "user_id": 5, "name": "Bilal", "date": "2026-11-20", "type": "maladie" } ],
  "disponibilites": [ { "user_id": 4, "name": "David", "date": "2026-11-20", "start": "13:00", "end": "20:00" } ],
  "employes": [ { "id": 4, "name": "David", "position": "Vendeur", "weekly_hours": 24 } ]
}
```

Sources et règles de mise à plat :

- **`published`** : `plannings.published_at IS NOT NULL` (`schema.js:1340-1371`). Une semaine absente donne `published: false` et des listes vides.
- **`shifts`** : `plannings.planning_data`, au format v2 `{ "__format": "v2", "<lieu>": { "<Jour>-<HH:MM>-<HH:MM>": [ {id, name, role} ] } }` (`entreprises.routes.js:860-864`).
  - Les cellules consécutives d'une même personne sont fusionnées en un service, comme le fait déjà `entreprises.routes.js:702-731`.
  - `Jour` (Lundi…Dimanche) est converti en date à partir de `week_start_date`.
  - `24:00` est conservé tel quel.
  - Au format v1 (sans niveau lieu), `lieu` vaut `null`.
- **`ouverture`** : `entreprises.opening_hours`, au format `{ monday: [{start, end}], … }`.
  - Lu avec `parseOpeningHours` / `openingRangesFor` (`utils/clickCollect.js:131-160`).
  - Une fermeture après minuit est coupée à `24:00`.
  - Sans horaires renseignés, liste vide : Jarvis ne signale alors aucun trou.
- **`absences`** : `planning_absences.absences_data` (`{ [userId]: { "AAAA-MM-JJ": type } }`), plus les demandes approuvées de `planning_leave_requests` (`status = 'approved'`) dépliées jour par jour.
- **`disponibilites`** : `planning_preferences.availability_data`.
  - L'override de la semaine (`__weeks["AAAA-MM-JJ"][userId]`, voir `getWeekAvailability` dans `planningUtils.js:153`) l'emporte sur le profil habituel `{ [userId]: { Lundi: {on, start, end} } }`.
  - Seuls les jours `on` sont rendus, convertis en dates.
- **`employes`** : `users` actifs de la boutique (`archived_at IS NULL`, via `entreprise_id` ou `user_entreprises`), avec `position` et `weekly_hours`.

À partir de ces données, Jarvis calcule :
- **les trous** : heures d'ouverture sans personne en poste, une fois les absents retirés ;
- **qui appeler** : les personnes disponibles sur tout le créneau, pas déjà en poste, les moins chargées de la semaine d'abord.

## Plus tard (non utilisé par Jarvis aujourd'hui)

- **Bon de commande en brouillon** : `POST /boutiques/:id/bons-commande`, seule écriture prévue, toujours validée par Jessim. Aujourd'hui, Manageo n'a de bons de commande fournisseur que pour le dépôt central (`depot_purchase_orders`). Les boutiques n'en ont pas : la colonne `orders.supplier_id` existe mais n'est jamais remplie. En attendant, Jarvis garde le bon dans sa propre base et, une fois validé, crée la tâche « Passer la commande ».
- **Alerte en temps réel** : un webhook appelé par Manageo quand un article passe sous son seuil, pour éviter d'attendre la relève de Jarvis (toutes les 15 minutes).
