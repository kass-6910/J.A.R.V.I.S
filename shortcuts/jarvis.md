# Raccourci « Jarvis »

Dicte une demande, l'envoie au serveur, crée sur l'iPhone les rappels et alarmes demandés, puis lit la réponse à voix haute. À créer dans l'app Raccourcis ; il se synchronise sur le Mac et l'Apple Watch par iCloud.

## Étapes

1. Nouveau raccourci, nommé **Jarvis**.
2. **Dicter le texte** : langue Français, arrêt de l'écoute « Après une pause ».
3. **Obtenir le contenu de l'URL**
   - URL : `https://ton-serveur/api/jarvis`
   - Méthode : `POST`
   - En-têtes : `Authorization` = `Bearer ` suivi du jeton (`JARVIS_TOKEN` du serveur)
   - Corps de la requête : JSON, avec deux clés :
     - `message` (Texte) : le **Texte dicté** ;
     - `rappels_sur_iphone` (Booléen) : **Vrai**.
4. **Obtenir la valeur du dictionnaire** : clé `rappels`, depuis le **Contenu de l'URL**.
5. **Répéter avec chaque élément** de la valeur obtenue. À l'intérieur de la boucle :
   1. **Obtenir la valeur du dictionnaire** : clé `type`, depuis l'**Élément de répétition**.
   2. **Si** la valeur **est** `alarme` :
      - **Obtenir la valeur du dictionnaire** : clé `heure`, depuis l'Élément de répétition ;
      - **Créer une alarme** à cette heure, avec pour libellé la valeur de la clé `titre`.
   3. **Sinon** :
      - **Obtenir la valeur du dictionnaire** : clé `date`, depuis l'Élément de répétition ;
      - **Ajouter un nouveau rappel** : titre = clé `titre`, cocher « Me le rappeler », date de l'alerte = la date obtenue.
   4. **Fin de si**.
6. **Fin de répétition**.
7. **Obtenir la valeur du dictionnaire** : clé `reponse`, depuis le **Contenu de l'URL**.
8. **Énoncer le texte** : la valeur obtenue.
9. Optionnel : **Afficher le résultat**.

Sans la clé `rappels_sur_iphone`, le serveur suppose que l'appareil ne sait pas créer de rappels et envoie une notification à la place : un ancien Raccourci ne perd donc aucun rappel.

## Déclenchement

- « Dis Siri, Jarvis » : le plus fiable.
- Mains libres : Réglages > Accessibilité > Raccourcis vocaux, enregistrer le mot « Jarvis » et le lier au raccourci.
- Bouton Action, ou double tap au dos du téléphone (Réglages > Accessibilité > Toucher > Toucher le dos de l'appareil).

## Format de l'API

Requête :

```json
{ "message": "rappelle-moi d'appeler le comptable demain à 9 h", "rappels_sur_iphone": true }
```

Réponse :

```json
{
  "reponse": "C'est noté, je te le rappelle demain à neuf heures.",
  "rappels": [
    { "titre": "Appeler le comptable", "date": "2026-11-21T09:00:00+01:00", "heure": "09:00", "type": "rappel" }
  ]
}
```

`type` vaut `rappel` (app Rappels) ou `alarme` (app Horloge). La liste `rappels` est vide la plupart du temps.

En cas de panne, le serveur renvoie quand même une clé `reponse` avec une phrase d'excuse, et une liste `rappels` vide, pour que le raccourci ne reste pas muet. Un jeton absent ou faux donne une erreur 401 sans clé `reponse`.
