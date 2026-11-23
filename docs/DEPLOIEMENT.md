# Mettre Jarvis en ligne sur le VPS de Manageo

Jarvis s'installe sur le même VPS que Manageo, à côté et sans le toucher :

- **Conteneurs séparés** : son application et sa propre base PostgreSQL (`docker-compose.prod.yml`). La base de Jarvis n'a aucun port publié et ne voit pas celle de Manageo.
- **Port local** `127.0.0.1:4100`, libre sur ce VPS. Déjà pris par les autres projets : 3000 (portfolio), 3001 à 3003, 3010, 4000, 5173, 5432 à 5434, 8081, 9080, 82, 83.
- **Sous-domaine** : `jarvis.kassdev.fr`, sur ton domaine perso et non sur celui de Manageo, avec son propre site nginx (`deploy/nginx-jarvis.conf`) et son propre certificat HTTPS.
- **Accès à Manageo** : uniquement par l'API publique `https://manageo.site/api/jarvis/v1`, avec sa clé dédiée (`docs/manageo-api.md`), jamais par la base de Manageo.

## Avant tout : la sécurité du VPS

Jarvis contiendra tes mails, ta santé, tes finances et tes papiers. Or `docs/DURCISSEMENT-VPS.md` (dépôt Manageo) indique que le pare-feu `ufw` est inactif et que des ports d'autres projets sont ouverts sur Internet, dont deux bases de données (5432 et 5434).

Terminer d'abord les phases 3 et 4 de ce document : ports liés à `127.0.0.1`, puis `ufw` avec seulement 22, 80 et 443 ouverts.

## Étapes

1. **DNS** : dans hPanel Hostinger (domaine `kassdev.fr`, enregistrements DNS), créer un enregistrement `A` nommé `jarvis` vers `72.62.185.231`. Jarvis a son propre domaine : aucun lien avec `manageo.site`. Vérifier avec `dig jarvis.kassdev.fr +short`.
2. **Code** :
   ```bash
   sudo git clone https://github.com/kass-6910/J.A.R.V.I.S.git /opt/jarvis
   ```
   La branche `main` est la version à mettre en ligne.
3. **Configuration** : copier `deploy/env.production.example` en `/opt/jarvis/.env` (`chmod 600 .env`), puis remplir les secrets. `JARVIS_TOKEN` et `JARVIS_DB_PASSWORD` se génèrent avec `openssl rand -hex 32`.
4. **Démarrage** :
   ```bash
   cd /opt/jarvis && docker compose -f docker-compose.prod.yml up -d --build
   ```
   Vérifier avec `curl http://127.0.0.1:4100/api/health`.
5. **nginx** :
   - copier `deploy/nginx-jarvis.conf` en `/etc/nginx/sites-available/jarvis` (en y mettant le bon sous-domaine) ;
   - activer le site : `ln -s /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/` ;
   - commenter le bloc HTTPS le temps d'obtenir le certificat : `sudo certbot --nginx -d jarvis.kassdev.fr` ;
   - vérifier et recharger : `nginx -t && systemctl reload nginx`.
6. **Connexions Google et Microsoft** : les commandes `google:auth` et `outlook:auth` se lancent depuis un ordinateur avec un navigateur (le Mac), dans une copie du dépôt avec le même `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `MS_CLIENT_ID`. Elles affichent les refresh tokens, à recopier dans le `.env` du serveur, puis :
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```
7. **Sauvegardes** : `deploy/backup.sh` chaque nuit par cron (la ligne est en tête du script). Il sauvegarde la base et le dossier `data` (photos, PDF).

## Mettre à jour

```bash
cd /opt/jarvis && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Les migrations de la base s'appliquent toutes seules au démarrage.

## Points à vérifier au premier démarrage

- Le `docker build` : l'image n'a pas pu être construite dans l'environnement de développement (pas de Docker). Son arborescence a en revanche été reproduite et testée : migrations, web app et API.
- Chaque connecteur réel, voir `TODO.md`.
