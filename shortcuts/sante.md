# Données Santé vers Jarvis

Jarvis reçoit le sommeil, les pas, les calories actives et les séances de sport de l'Apple Watch sur `POST /api/health/ingest`. Deux façons de les envoyer, au choix.

## Option 1 : app Health Auto Export (la plus simple)

Dans l'app, créer une **automatisation REST API** :

- URL : `https://ton-serveur/api/health/ingest`
- En-tête : `Authorization` = `Bearer ` suivi du jeton de Jarvis
- Format : JSON, version 2
- Données : `Step Count`, `Active Energy`, `Sleep Analysis` (agrégée), et les séances (`Workouts`)
- Période : depuis la dernière synchronisation ; fréquence : toutes les heures, ou au moins le matin et le soir

Jarvis additionne les données par jour, quelle que soit l'agrégation choisie, et rattache chaque nuit au jour du réveil.

## Option 2 : Raccourci « Santé » du soir

Un raccourci lancé chaque soir par une automatisation (onglet **Automatisation**, « Heure de la journée », 22 h, sans demander) :

1. **Rechercher des échantillons Santé** : type Nombre de pas, date aujourd'hui → **Calculer les statistiques** : somme.
2. Même chose pour Énergie active.
3. **Rechercher des échantillons Santé** : type Analyse du sommeil, date aujourd'hui, valeur « Endormi » → durée totale en minutes.
4. **Rechercher des séances** (Workouts) d'aujourd'hui.
5. **Obtenir le contenu de l'URL** : `POST https://ton-serveur/api/health/ingest`, en-tête `Authorization`, corps JSON :

```json
{
  "jour": "2026-11-20",
  "pas": 8123,
  "calories_actives": 450,
  "sommeil_minutes": 402,
  "coucher": "2026-11-19T23:40:00+01:00",
  "reveil": "2026-11-20T06:22:00+01:00",
  "seances": [ { "type": "Musculation", "debut": "2026-11-20T18:30:00+01:00", "fin": "2026-11-20T19:30:00+01:00", "calories": 410 } ]
}
```

Tous les champs sauf `jour` sont facultatifs : un champ absent ne remplace pas une valeur déjà reçue.

## Séance sans la montre

« Jarvis, j'ai fait ma séance », ou le bouton **Séance faite** de l'écran Santé : la séance compte dans les trois de la semaine et disparaît du planning.
