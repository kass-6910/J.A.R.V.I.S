# J.A.R.V.I.S

Assistant vocal personnel : tâches, planning, et plus tard mails, Manageo, santé et le reste.
Le cahier des charges fait foi ; ce dépôt couvre ses étapes 1 (serveur, base, tâches, planning, voix, web app minimale) et 2 (notifications, rappels, briefing du matin, bilan du soir).

## Ce qui marche aujourd'hui

- **Tâches** : titre, durée, priorité, échéance, un ou plusieurs espaces.
- **Planning du jour** : les tâches sont placées dans les créneaux libres autour des rendez-vous Google Agenda, et la journée est recalée à chaque changement.
- **Voix** : `POST /api/jarvis` reçoit le texte dicté par le Raccourci iPhone et renvoie une réponse courte à lire à voix haute. Claude crée, modifie, termine et réordonne les tâches.
- **Validation** : une suppression demandée à Jarvis est mise en attente et se valide dans la web app.
- **Rappels** : « Jarvis, rappelle-moi ça demain à 9 h ». Trois niveaux : rappel iPhone (par défaut, créé par le Raccourci dans l'app Rappels), alarme (« réveille-moi », « c'est urgent ») ou notification envoyée par le serveur. Depuis la web app, tout passe par notification.
- **Notifications push** via ntfy : rappels, échéance d'une tâche dans moins de deux heures, briefing et bilan.
- **Briefing du matin** (07:00 par défaut) : la journée est recalée, puis Claude rédige un texte d'environ une minute : retour sur la veille (fait, pas fait, temps prévu contre temps réel), programme du jour, échéances, une ou deux pistes. Il arrive en notification, s'affiche sur l'accueil et s'écoute par le Raccourci « Briefing ».
- **Bilan du soir** (21:30 par défaut) : ce qui est fait, ce qui reste, l'aperçu de demain ; le dimanche, le bilan de la semaine avec la tendance. Si Claude est injoignable, une version de secours est rédigée à partir des faits bruts.
- **Web app** : écrans Accueil et Tâches, installable sur l'écran d'accueil de l'iPhone. Un bouton micro permet de parler à Jarvis, qui répond à voix haute (dictée et voix du navigateur, il faut être en HTTPS).

Pas encore là : mails, Manageo, santé, transcription côté serveur (Whisper), écriture dans Google Agenda (l'agenda est lu, jamais modifié).

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

## Brancher les notifications

1. Installer l'app **ntfy** sur l'iPhone.
2. Choisir un sujet long et imprévisible, le mettre dans `NTFY_TOPIC`, et s'y abonner dans l'app.
3. Redémarrer le serveur, puis envoyer une notification de test :

```bash
curl -X POST https://ton-serveur/api/notifications/test -H "Authorization: Bearer $JARVIS_TOKEN"
```

Avec le service public ntfy.sh, les messages (dont le texte du briefing) transitent par ses serveurs. Pour les garder chez soi, ntfy peut être installé sur le VPS ; `NTFY_URL` pointe alors vers lui.

## Structure

| Dossier | Rôle |
|---|---|
| `server/src/api` | Routes HTTP appelées par la web app et les Raccourcis |
| `server/src/brain` | Reçoit un message, charge le contexte, appelle Claude avec les outils |
| `server/src/tools` | Actions que Claude peut déclencher |
| `server/src/services` | Logique métier : tâches, planning, validations |
| `server/src/planner` | Tri et placement des tâches (fonctions pures, testées) |
| `server/src/briefing` | Bilan d'une période pour le briefing et le bilan (fonctions pures, testées) |
| `server/src/jobs` | Planificateur : rappels, alertes d'échéance, briefing et bilan |
| `server/src/connectors` | Un module par service extérieur : Google Agenda, ntfy |
| `server/src/db` | Schéma Drizzle ; migrations dans `server/drizzle` |
| `web` | Web app React |
| `shortcuts` | Documentation des Raccourcis iPhone |

## Commandes

| Commande | Effet |
|---|---|
| `npm test` | Tests du planificateur, du bilan et des routines |
| `npm run typecheck` | Vérification des types, serveur et web |
| `npm run db:generate` | Génère une migration après un changement de `schema.ts` |
