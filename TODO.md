# À faire

Ce qui reste pour que Jarvis tourne entièrement en conditions réelles. Le code de Jarvis est prêt de son côté sauf mention contraire.

## Manageo

- [ ] **Exposer l'API Jarvis dans Manageo**, selon `docs/manageo-api.md` :
  - clé dédiée `mgj_…`, en lecture seule, révocable ;
  - routes boutiques, stock, consommation, ventes du jour, planning.

  À faire dans le dépôt Manageo, sur une branche à part, validée par Jessim avant la mise en ligne.
- [ ] Trancher la convention HT ou TTC du chiffre d'affaires (`orders.total_amount`), voir la spécification.
- [ ] Renseigner dans Manageo un seuil et un fournisseur pour chaque article des deux boutiques.
- [ ] Plus tard : création d'un bon de commande en brouillon depuis Jarvis (seule écriture prévue), et webhook « stock sous le seuil ».

## Vérifications au premier démarrage sur le serveur

Ces services n'étaient pas joignables depuis l'environnement de développement : leurs connecteurs suivent le format documenté mais n'ont jamais reçu de vraie réponse.

- [ ] Horaires de prière (Aladhan) : vérifier les heures du jour pour Lyon et la méthode de calcul choisie.
- [ ] Rappel du jour (collection hadith-api) : vérifier qu'un hadith arrive bien avec son recueil et son numéro.
- [ ] Gmail, Outlook de l'école, Google Agenda, ntfy, Claude : premier vrai passage de chaque connecteur.

## Vie quotidienne

- [ ] Drive : choisir le site du drive (cahier, §16), puis automatiser le remplissage du panier depuis la liste de courses ; le paiement reste validé par Jessim.
- [ ] `PUBLIC_URL` doit être renseigné pour que le bouton « Pris » des notifications de compléments apparaisse.

## Options hors V1 (cahier des charges)

- [ ] Réseaux sociaux : Meta Business Suite (Instagram, Facebook).
- [ ] Messages WhatsApp envoyés par un Raccourci.
- [ ] Alertes « zone de danger » à partir des radars fixes publiés en open data.
- [ ] Voix ElevenLabs, appli iPhone native (React Native + Expo, TestFlight).
