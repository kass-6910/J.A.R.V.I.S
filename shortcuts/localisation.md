# Arrivées et départs (automatisations iPhone)

Jarvis ne suit pas la position en permanence. L'iPhone signale seulement l'arrivée et le départ des lieux enregistrés ; à chaque arrivée, Jarvis demande « Je suis là pour… » ou « De passage », et seule une présence confirmée déclenche quelque chose :

| Lieu | Après « je suis là » |
|---|---|
| `salle` | Séance démarrée, terminée au départ (une visite de moins de 10 minutes ne compte pas) |
| `lmdd-confluence`, `lmdd-croix-rousse` | Alertes de la boutique (stock, ruptures, équipe), journée recalée |
| `ecole`, `maison`, autre | Lieu actuel noté, journée recalée |

« De passage », ou pas de réponse : rien ne change.

## Créer une automatisation

Dans l'app Raccourcis, onglet **Automatisation**, pour chaque lieu (salle, LMDD Confluence, LMDD Croix-Rousse, école, maison) :

1. Nouvelle automatisation **Arrivée**, choisir le lieu sur la carte, « Exécuter immédiatement ».
2. Action **Obtenir le contenu de l'URL** :
   - URL : `https://ton-serveur/api/events/location`
   - Méthode : `POST`
   - En-tête : `Authorization` = `Bearer ` suivi du jeton de Jarvis
   - Corps JSON : `lieu` = le nom court du lieu (tableau ci-dessus), `evenement` = `arrivee`
3. Même chose avec une automatisation **Départ** et `evenement` = `depart`.

La réponse arrive en notification, avec deux boutons. Sans `PUBLIC_URL` sur le serveur, les boutons n'apparaissent pas : la question s'affiche alors sur l'accueil de la web app.

On peut aussi simplement dire « Jarvis, je suis à la salle ».

## Trajets

Pour les rendez-vous de Google Agenda qui ont une adresse, Jarvis calcule le temps de trajet avec le trafic (Google Maps), depuis le lieu où tu as confirmé être ou depuis la maison. Il bloque ce temps dans le planning et envoie « Pars maintenant » au bon moment, avec des boutons Google Maps et Waze. Les adresses des lieux se renseignent dans **Réglages** ou à la voix (« Jarvis, l'adresse de la maison est… »).
