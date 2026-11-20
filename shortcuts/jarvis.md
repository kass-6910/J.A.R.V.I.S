# Raccourci « Jarvis »

Dicte une demande, l'envoie au serveur et lit la réponse à voix haute. À créer dans l'app Raccourcis ; il se synchronise sur le Mac et l'Apple Watch par iCloud.

## Étapes

1. Nouveau raccourci, nommé **Jarvis**.
2. **Dicter le texte** : langue Français, arrêt de l'écoute « Après une pause ».
3. **Obtenir le contenu de l'URL**
   - URL : `https://ton-serveur/api/jarvis`
   - Méthode : `POST`
   - En-têtes : `Authorization` = `Bearer ` suivi du jeton (`JARVIS_TOKEN` du serveur)
   - Corps de la requête : JSON, avec une clé `message` (type Texte) dont la valeur est le **Texte dicté**
4. **Obtenir la valeur du dictionnaire** : clé `reponse`.
5. **Énoncer le texte** : la valeur obtenue.
6. Optionnel : **Afficher le résultat**.

## Déclenchement

- « Dis Siri, Jarvis » : le plus fiable.
- Mains libres : Réglages > Accessibilité > Raccourcis vocaux, enregistrer le mot « Jarvis » et le lier au raccourci.
- Bouton Action, ou double tap au dos du téléphone (Réglages > Accessibilité > Toucher > Toucher le dos de l'appareil).

## Format de l'API

Requête :

```json
{ "message": "note : appeler le fournisseur demain" }
```

Réponse :

```json
{ "reponse": "C'est noté, j'ai placé l'appel au fournisseur demain matin." }
```

En cas de panne, le serveur renvoie quand même une clé `reponse` avec une phrase d'excuse, pour que le raccourci ne reste pas muet. Un jeton absent ou faux donne une erreur 401 sans clé `reponse`.
