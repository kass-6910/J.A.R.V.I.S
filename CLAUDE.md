# Jarvis : règles du projet

Assistant personnel de Jessim. Une seule application Node.js (TypeScript, Fastify) avec PostgreSQL (Drizzle) et une web app React (Vite). Le cahier des charges fait foi sur le périmètre et l'ordre des étapes.

## Commandes

- `npm test` : tests (Vitest, dans `server`).
- `npm run typecheck` : types du serveur et de la web app. À lancer avant chaque commit.
- `npm run db:generate` : après toute modification de `server/src/db/schema.ts`. Ne jamais éditer une migration déjà commitée.
- Lancer en local : PostgreSQL (`docker compose up -d`), un `.env` copié de `.env.example`, puis `npm run dev`.

## Architecture

- `api` → `services` → `db`. Les routes et les outils de Claude appellent les mêmes services ; aucune logique métier dans `api` ni dans `tools`.
- `planner` ne contient que des fonctions pures, sans base ni horloge. Tout changement y est couvert par un test.
- Un connecteur par service extérieur dans `connectors`, sans dépendance vers le reste, pour rester interchangeable.
- Après chaque changement de tâche, appeler `replanToday()` : la journée est toujours recalée.
- Tous les calculs de date passent par `lib/time.ts` (fuseau `TIMEZONE`, Europe/Paris par défaut).

## Règles de sécurité (non négociables)

- Jarvis propose, Jessim valide : tout envoi, suppression, commande ou paiement déclenché par Claude passe par `requestValidation` dans `services/actions.ts` et n'est exécuté qu'à la confirmation.
- Accès aux services extérieurs avec les droits minimum, lecture seule par défaut.
- Aucune clé dans le code : tout passe par les variables d'environnement, déclarées dans `config.ts` et `.env.example`.
- Toutes les routes `/api` sauf `/api/health` exigent le jeton.

## IA

- SDK officiel `@anthropic-ai/sdk`, boucle d'outils via `client.beta.messages.toolRunner` et `betaZodTool`.
- Cerveau : modèle `JARVIS_MODEL` (Claude Sonnet). Tâches de fond futures : Claude Haiku.
- Les réponses sont lues à voix haute : courtes, en français, sans markdown.
- Le contexte du jour est injecté dans le message utilisateur, pas dans le prompt système, qui reste stable.

## Conventions

- Textes d'interface, messages d'erreur et commentaires en français ; identifiants de code en anglais.
- Web app : palette et règles de design du cahier des charges (§15), définies en variables CSS dans `web/src/styles.css`.
