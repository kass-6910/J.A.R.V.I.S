# J.A.R.V.I.S

Assistant vocal personnel : tâches, planning, et plus tard mails, Manageo, santé et le reste.
Le cahier des charges fait foi ; ce dépôt en est l'étape 1 (serveur, base, tâches, planning, voix, web app minimale).

## Ce qui marche aujourd'hui

- **Tâches** : titre, durée, priorité, échéance, un ou plusieurs espaces.
- **Planning du jour** : les tâches sont placées dans les créneaux libres autour des rendez-vous Google Agenda, et la journée est recalée à chaque changement.
- **Voix** : `POST /api/jarvis` reçoit le texte dicté par le Raccourci iPhone et renvoie une réponse courte à lire à voix haute. Claude crée, modifie, termine et réordonne les tâches.
- **Validation** : une suppression demandée à Jarvis est mise en attente et se valide dans la web app.
- **Web app** : écrans Accueil et Tâches, installable sur l'écran d'accueil de l'iPhone.

Pas encore là : notifications et rappels, briefing et bilan, mails, Manageo, santé, bouton micro de la web app, écriture dans Google Agenda (l'agenda est lu, jamais modifié).

## Démarrer

Il faut Node.js 22 ou plus et PostgreSQL 16 (le `docker-compose.yml` en fournit un).

```bash
docker compose up -d
```

```bash
cp .env.example .env
```

Dans `.env`, renseigner au minimum `JARVIS_TOKEN` (`openssl rand -hex 32`) et `ANTHROPIC_API_KEY`.

```bash
npm install
```

```bash
npm run dev
```

Le serveur écoute sur le port 3000 et la web app de développement sur le 5173. Les migrations de la base s'appliquent au démarrage.

En production, sur le VPS :

```bash
npm run build
```

```bash
npm start
```

Le serveur sert alors aussi la web app. Il doit être placé derrière HTTPS (Tailscale ou un reverse proxy).

## Connecter Google Agenda

1. Dans Google Cloud, activer l'API Google Calendar et créer un client OAuth de type « Application de bureau ».
2. Mettre `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`.
3. Sur une machine avec un navigateur, lancer la commande ci-dessous et recopier la ligne `GOOGLE_REFRESH_TOKEN=` affichée dans `.env`.

```bash
npm run google:auth -w server
```

`GOOGLE_CALENDAR_IDS` accepte plusieurs agendas séparés par des virgules.

## Structure

| Dossier | Rôle |
|---|---|
| `server/src/api` | Routes HTTP appelées par la web app et les Raccourcis |
| `server/src/brain` | Reçoit un message, charge le contexte, appelle Claude avec les outils |
| `server/src/tools` | Actions que Claude peut déclencher |
| `server/src/services` | Logique métier : tâches, planning, validations |
| `server/src/planner` | Tri et placement des tâches (fonctions pures, testées) |
| `server/src/connectors` | Un module par service extérieur (Google Agenda pour l'instant) |
| `server/src/db` | Schéma Drizzle ; migrations dans `server/drizzle` |
| `web` | Web app React |
| `shortcuts` | Documentation des Raccourcis iPhone |

## Commandes

| Commande | Effet |
|---|---|
| `npm test` | Tests du planificateur |
| `npm run typecheck` | Vérification des types, serveur et web |
| `npm run db:generate` | Génère une migration après un changement de `schema.ts` |
