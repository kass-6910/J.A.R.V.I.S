# Jarvis pour iPhone

L'app native de Jarvis (Expo, React Native). Elle parle au même serveur que la web app :
`https://jarvis.kassdev.fr`, avec le même jeton (`JARVIS_TOKEN`).

- **Maintenir le bouton micro pour parler** : Jarvis écoute tant que le bouton est maintenu et répond dès qu'on le lâche. Il n'attend pas de silence.
- Réponse **au fil de l'eau** (route `/api/jarvis/stream`) : la voix commence à la première phrase.
- Voix : la meilleure voix française installée sur l'iPhone. Pour une voix plus naturelle : Réglages > Accessibilité > Contenu énoncé > Voix > Français, puis télécharger une voix « Premium » ou « améliorée ».
- Planning du jour, actions à valider, crédits Claude.
- Adresse et jeton gardés dans le trousseau de l'iPhone.

## Installer sur l'iPhone (TestFlight)

Il faut une seule fois :

1. Un compte **Apple Developer** (99 $ par an) : https://developer.apple.com/programs/enroll/ (validation sous 48 h environ).
2. Un compte **Expo**, gratuit : https://expo.dev/signup

Puis, sur le Mac, dans le dossier du dépôt :

```bash
cd mobile
npm install
npx eas-cli@latest login
npm run build:ios
```

EAS construit l'app dans le cloud (pas besoin de Xcode). Il demande ton identifiant Apple et crée seul les certificats. Compter 15 à 20 minutes.

```bash
npm run submit:ios
```

L'app arrive dans **TestFlight** (App Store) après le traitement d'Apple, sous 30 minutes environ. Installer TestFlight sur l'iPhone, ouvrir Jarvis et coller le jeton.

Pour une nouvelle version : relancer `npm run build:ios` puis `npm run submit:ios`.

## Développer

```bash
npm run typecheck
npx expo export --platform ios   # vérifie que l'app se compile
```

Le micro (`expo-speech-recognition`) est un module natif : l'app ne marche pas dans Expo Go, seulement dans un build (`eas build`).
