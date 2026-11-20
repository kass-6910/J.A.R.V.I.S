# Raccourci « Briefing »

Lit à voix haute le dernier briefing du jour : le briefing du matin, ou le bilan du soir une fois rédigé. S'il n'existe pas encore, le serveur rédige celui du matin.

## Étapes

1. Nouveau raccourci, nommé **Briefing**.
2. **Obtenir le contenu de l'URL**
   - URL : `https://ton-serveur/api/briefing`
   - Méthode : `GET`
   - En-têtes : `Authorization` = `Bearer ` suivi du jeton
3. **Obtenir la valeur du dictionnaire** : clé `reponse`.
4. **Énoncer le texte** : la valeur obtenue.

« Dis Siri, Briefing » le lance. On peut aussi simplement demander « Jarvis, mon briefing » au Raccourci « Jarvis ».

## L'écouter automatiquement le matin

Dans l'app Raccourcis, onglet **Automatisation** : nouvelle automatisation **Réveil** (« Quand mon réveil est arrêté »), action **Exécuter le raccourci** > Briefing, et désactiver « Demander avant d'exécuter ». Le briefing est rédigé à `BRIEFING_TIME` : régler cette heure un peu avant le réveil.
