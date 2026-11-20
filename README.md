# J.A.R.V.I.S

Assistant vocal personnel : tâches, planning, et plus tard mails, Manageo, santé et le reste.
Le cahier des charges fait foi ; ce dépôt couvre ses étapes 1 (serveur, base, tâches, planning, voix, web app minimale), 2 (notifications, rappels, briefing du matin, bilan du soir), 3 (mails, espaces et liens) et 4 (Manageo, santé, prière).

## Ce qui marche aujourd'hui

- **Tâches** : titre, durée, priorité, échéance, un ou plusieurs espaces.
- **Planning du jour** : les tâches sont placées dans les créneaux libres autour des rendez-vous Google Agenda, et la journée est recalée à chaque changement.
- **Voix** : `POST /api/jarvis` reçoit le texte dicté par le Raccourci iPhone et renvoie une réponse courte à lire à voix haute. Claude crée, modifie, termine et réordonne les tâches.
- **Validation** : une suppression demandée à Jarvis est mise en attente et se valide dans la web app.
- **Rappels** : « Jarvis, rappelle-moi ça demain à 9 h ». Trois niveaux : rappel iPhone (par défaut, créé par le Raccourci dans l'app Rappels), alarme (« réveille-moi », « c'est urgent ») ou notification envoyée par le serveur. Depuis la web app, tout passe par notification.
- **Notifications push** via ntfy : rappels, échéance d'une tâche dans moins de deux heures, briefing et bilan.
- **Briefing du matin** (07:00 par défaut) : la journée est recalée, puis Claude rédige un texte d'environ une minute : retour sur la veille (fait, pas fait, temps prévu contre temps réel), programme du jour, échéances, une ou deux pistes. Il arrive en notification, s'affiche sur l'accueil et s'écoute par le Raccourci « Briefing ».
- **Bilan du soir** (21:30 par défaut) : ce qui est fait, ce qui reste, l'aperçu de demain ; le dimanche, le bilan de la semaine avec la tendance. Si Claude est injoignable, une version de secours est rédigée à partir des faits bruts.
- **Mails** : Gmail et l'Outlook de l'école sont relevés toutes les 15 minutes. Claude Haiku trie chaque mail (important ou non, résumé en une phrase, réponse attendue, espace(s), examen ou rendu annoncé). Les mails importants arrivent en notification, dans le contexte de Jarvis et dans le briefing. Jarvis peut lire un mail et proposer une réponse : elle part seulement après validation dans la web app, dans le fil d'origine. Jarvis ne supprime ni ne déplace jamais rien dans la boîte mail. Si Claude est injoignable, le mail est retenté puis classé par un tri de secours.
- **Espaces et liens** : tâches et mails sont rangés dans les cinq espaces. Une tâche saisie sans espace dans l'app est classée par Claude Haiku (ou laissée sans espace en cas de doute). Un élément rangé dans plusieurs espaces apparaît comme lien.
- **Boutiques LMDD (Manageo)** : relevé toutes les 15 minutes par une API dédiée, en lecture seule (`docs/manageo-api.md`).
  - Alerte dès qu'un article passe sous son seuil.
  - Rupture prévue d'après la vitesse des ventes des quatorze derniers jours (« plus de café dans 2 jours »).
  - Bon de commande pré-rempli par fournisseur, à valider ; une fois validé, la tâche « Passer la commande » est créée.
  - Trous dans le planning de l'équipe (heures d'ouverture sans personne, absences comprises), avec qui appeler.
  - Chiffre d'affaires de la veille comparé à la semaine précédente, dans le briefing.
- **Santé** : sommeil, pas, calories et séances reçus de l'iPhone (Health Auto Export ou Raccourci, voir `shortcuts/sante.md`). Trois séances de sport par semaine sont placées dans la journée, espacées d'un jour de repos et allégées après une nuit courte. Jessim peut déclarer une séance à la voix ou dans l'app.
- **Prière** : horaires du jour calculés pour Lyon (Aladhan, méthode réglable), placés dans le planning comme créneaux protégés, avec une notification avant chaque prière. Le rappel du jour est un hadith tiré d'un recueil publié, cité avec son numéro, jamais rédigé par l'IA.
- **Web app** : écrans Accueil (briefing, rappel du jour, validations, alertes des boutiques, rappels, mails à suivre, journée), Tâches, Espaces (tableau de chaque espace avec la section Manageo des boutiques, liens entre espaces) et Santé, installable sur l'écran d'accueil de l'iPhone. Un bouton micro permet de parler à Jarvis, qui répond à voix haute (dictée et voix du navigateur, il faut être en HTTPS).

Pas encore là : repas, compléments, soins perso, courses et drive, garde-robe, administratif, trajets, budget, proches, localisation, santé, transcription côté serveur (Whisper), écriture dans Google Agenda (l'agenda est lu, jamais modifié).

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

## Brancher les mails

**Gmail** : relancer `npm run google:auth -w server` (les droits Gmail s'ajoutent à ceux de l'agenda), remplacer `GOOGLE_REFRESH_TOKEN`, puis mettre `GMAIL_ENABLED=true`.

**Outlook de l'école** : inscrire une application dans Microsoft Entra (type « client public », droits délégués `Mail.Read` et `Mail.Send`), mettre son identifiant dans `MS_CLIENT_ID`, puis :

```bash
npm run outlook:auth -w server
```

La commande affiche un code à saisir sur le site de Microsoft, puis la ligne `MS_REFRESH_TOKEN=` à copier dans `.env`. L'école peut bloquer les applications externes : son accord est alors nécessaire.

## Brancher Manageo

Manageo doit d'abord exposer l'API décrite dans `docs/manageo-api.md` et créer une clé dédiée à Jarvis. Ensuite, `MANAGEO_URL` et `MANAGEO_API_KEY` suffisent.

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
| `server/src/connectors` | Un module par service extérieur : Google (Agenda, Gmail), Microsoft (Outlook), Manageo, Aladhan et la collection de hadiths, ntfy |
| `server/src/manageo`, `server/src/health` | Analyse des stocks et du planning de l'équipe, lecture des exports Santé et règles du sport (fonctions pures, testées) |
| `server/src/db` | Schéma Drizzle ; migrations dans `server/drizzle` |
| `web` | Web app React |
| `shortcuts` | Documentation des Raccourcis iPhone |
| `docs` | Spécification de l'API que Manageo expose à Jarvis |

## Commandes

| Commande | Effet |
|---|---|
| `npm test` | Tests des fonctions pures : planning, bilan, routines, mails, prière, santé, Manageo |
| `npm run typecheck` | Vérification des types, serveur et web |
| `npm run db:generate` | Génère une migration après un changement de `schema.ts` |
