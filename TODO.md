# À faire

Ce qui reste pour que Jarvis tourne en conditions réelles. Le code de Jarvis est prêt de son côté, sauf mention contraire.

Les clés et mots de passe ne s'envoient jamais dans une conversation ni dans Git : ils se rangent dans le fichier `.env` du serveur, sous le nom de variable indiqué.

## 1. Sécurité du VPS (partagé avec Manageo)

- [x] Bases de données et ports des autres projets fermés à Internet (21/11/2026). Manageo n'est pas touché.
- [ ] Garder le pare-feu `ufw`. Sur le serveur, `/root/securiser-vps.sh --appliquer`, tester SSH dans un deuxième onglet, puis `/root/securiser-vps.sh --confirmer` dans les 10 minutes (voir `docs/SECURISER-VPS.md`).
- [ ] Changer le mot de passe root (`passwd`) : il a été écrit en clair dans une conversation.
- [ ] Remplacer les secrets apparus en clair dans une conversation ou une capture : `JARVIS_TOKEN` et `JARVIS_DB_PASSWORD` (`openssl rand -hex 32`), clé Claude (https://platform.claude.com/settings/keys), code secret du client Google (Google Cloud → Clients → Jarvis → ajouter un secret, puis supprimer l'ancien).
- [ ] Plus tard : passer d'Ubuntu 25.10 (plus maintenu) à 26.04 LTS, en préparant tous les projets du serveur.
- [ ] Passer le dépôt GitHub de Jarvis en privé : https://github.com/kass-6910/J.A.R.V.I.S/settings (en bas, « Change visibility »).

## 2. Comptes et accès à créer

### Indispensable

| Quoi | Page | Variable du `.env` |
|---|---|---|
| Clé de l'IA (Claude) — fait, **expire le 23/12/2026** : la renouveler avant | https://platform.claude.com/settings/keys | `ANTHROPIC_API_KEY` |
| Plafond de dépense de l'IA | https://platform.claude.com/settings/limits | — |
| Jeton secret de Jarvis | sur le serveur : `openssl rand -hex 32` | `JARVIS_TOKEN` |
| Mot de passe de la base | sur le serveur : `openssl rand -hex 32` | `JARVIS_DB_PASSWORD` |
| Notifications | app « ntfy » sur l'App Store (https://ntfy.sh), sujet long et imprévisible — fait | `NTFY_TOPIC` |

### Google : Agenda, Gmail, trajets (un seul projet)

- [x] Agenda et Gmail connectés (23/11/2026) : projet « jarvis » publié « En production », client « Application de bureau ». Reste la clé API Routes pour les trajets.

| Étape | Page |
|---|---|
| Créer le projet | https://console.cloud.google.com/projectcreate |
| Activer l'API Agenda | https://console.cloud.google.com/apis/library/calendar-json.googleapis.com |
| Activer l'API Gmail | https://console.cloud.google.com/apis/library/gmail.googleapis.com |
| Activer l'API Routes (trajets) | https://console.cloud.google.com/apis/library/routes.googleapis.com |
| Écran de consentement | https://console.cloud.google.com/auth/overview |
| Identifiants | https://console.cloud.google.com/apis/credentials |

Dans les identifiants :

- un **ID client OAuth**, de type « Application de bureau » → `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` ;
- une **clé API**, limitée à l'API Routes → `GOOGLE_MAPS_API_KEY`.

Ensuite :

1. Refresh token : directement sur le serveur, voir `node dist/connectors/google/authorize.js` (en-tête du fichier `server/src/connectors/google/authorize.ts`).
2. Mettre `GMAIL_ENABLED=true`.

### Outlook de l'école

| Étape | Page |
|---|---|
| Inscrire une application (« Inscriptions d'applications », client public, droits `Mail.Read` et `Mail.Send`) | https://entra.microsoft.com |
| Saisir le code affiché par `npm run outlook:auth -w server` | https://microsoft.com/devicelogin |

Variables : `MS_CLIENT_ID`, puis `MS_REFRESH_TOKEN`.

L'école peut bloquer les applications externes : demander son accord en premier.

### iPhone

- [ ] App « Health Auto Export » (App Store), réglée selon `shortcuts/sante.md`.
- [ ] Raccourcis « Jarvis » (`shortcuts/jarvis.md`) et « Briefing » (`shortcuts/briefing.md`).
- [ ] Automatisations d'arrivée et de départ (`shortcuts/localisation.md`).

## 3. Mise en ligne de Jarvis

- [x] Sous-domaine `jarvis.kassdev.fr` : dans https://hpanel.hostinger.com → Domaines → kassdev.fr → Enregistrements DNS, créer un enregistrement `A` nommé `jarvis` vers `72.62.185.231`. Vérifier avec `dig jarvis.kassdev.fr +short`.
- [x] Jarvis en ligne sur https://jarvis.kassdev.fr (23/11/2026) : code, `.env`, `docker compose`, nginx, certificat HTTPS.
- [ ] Sauvegardes nocturnes : ajouter la ligne cron de `deploy/backup.sh`.
- [ ] Renseigner `PUBLIC_URL` (sinon pas de boutons « Pris » ni « Je suis là » dans les notifications).
- [ ] Renseigner les adresses des lieux dans l'écran Réglages (trajets).

## 4. Vérifications au premier démarrage

Ces services n'étaient pas joignables depuis l'environnement de développement : leurs connecteurs suivent le format documenté mais n'ont jamais reçu de vraie réponse.

- [x] Horaires de prière (Aladhan) : reçus pour Lyon (Maghrib à 17 h 03 le 23/11).
- [ ] Rappel du jour (collection hadith-api) : vérifier qu'un hadith arrive avec son recueil et son numéro.
- [ ] Météo (Open-Meteo) : vérifier la prévision du jour pour Lyon.
- [ ] Trajets (API Routes) : vérifier un temps de trajet en TCL et en voiture.
- [x] Claude : premières vraies réponses de Jarvis (23/11).
- [x] Google Agenda et Gmail : connectés (23/11).
- [ ] Outlook de l'école, ntfy (notifications envoyées par Jarvis) : premier vrai passage.

## 5. Manageo

- [ ] **Exposer l'API Jarvis dans Manageo**, selon `docs/manageo-api.md` :
  - clé dédiée `mgj_…`, en lecture seule, révocable ;
  - routes boutiques, stock, consommation, ventes du jour, planning.

  À faire dans le dépôt Manageo, sur une branche à part, validée avant la mise en ligne. Une fois fait : `MANAGEO_URL=https://manageo.site` et `MANAGEO_API_KEY`.
- [ ] Trancher si le chiffre d'affaires (`orders.total_amount`) est HT ou TTC.
- [ ] Renseigner dans Manageo un seuil et un fournisseur pour chaque article des deux boutiques.
- [ ] Plus tard : bon de commande en brouillon depuis Jarvis (seule écriture prévue), webhook « stock sous le seuil ».
- [ ] Si un jour la phase 4 de `docs/DURCISSEMENT-VPS.md` (dépôt Manageo) est reprise : sa ligne `/api/auth/login` pointe vers le port 8081 au lieu de 4000, et casserait la connexion.

## 6. Vie quotidienne

- [ ] Drive : choisir le site du drive (cahier des charges, §16), puis automatiser le remplissage du panier depuis la liste de courses ; le paiement reste validé par Jessim.

## Options hors V1 (cahier des charges)

- [ ] Réseaux sociaux : Meta Business Suite (Instagram, Facebook).
- [ ] Messages WhatsApp envoyés par un Raccourci.
- [ ] Alertes « zone de danger » à partir des radars fixes publiés en open data.
- [ ] Voix ElevenLabs, appli iPhone native (React Native + Expo, TestFlight).
