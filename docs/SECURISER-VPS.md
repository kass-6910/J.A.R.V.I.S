# Sécuriser le VPS sans toucher à Manageo

Phases 3 et 4 de `docs/DURCISSEMENT-VPS.md` (dépôt Manageo), adaptées pour que Manageo ne soit pas touché.

## Ce qui change

| | Avant | Après |
|---|---|---|
| Bases managouss (5432) et 3proj (5434) | Ouvertes sur Internet | Fermées à Internet, toujours joignables par leurs applications sur le serveur |
| Ports 3000, 3001, 3010, 5173, 82, 83 | Ouverts sur Internet | Fermés à Internet ; les sites servis par nginx (kassdev.fr…) continuent de marcher |
| Pare-feu `ufw` | Inactif | Actif : seuls SSH, 80 et 443 entrent |
| **Manageo** | — | **Rien** : ni ses ports, ni ses conteneurs, ni son nginx, ni sa base |

Conséquence à connaître : tryfit (`IP:82`) et le site lmdd (`IP:83`), qui n'ont pas de site nginx, ne seront plus joignables directement par l'adresse IP. Pour en rouvrir un, retirer son port de `PORTS_A_FERMER` en tête du script, puis relancer avec `--appliquer`.

La phase 4 (en-têtes de sécurité et limite de connexion du nginx de Manageo) n'est **pas** appliquée, à ta demande. Le site de Jarvis a ses propres en-têtes (`deploy/nginx-jarvis.conf`).

À noter si tu reprends un jour la phase 4 : la ligne proposée dans `DURCISSEMENT-VPS.md` envoie `/api/auth/login` vers `localhost:8081` (l'interface web) au lieu de `localhost:4000` (l'API). Appliquée telle quelle, elle empêcherait toute connexion à Manageo.

## Comment c'est fait sans risque pour Manageo

- **Aucun fichier modifié** : pas un `docker-compose.yml`, aucun conteneur redémarré. Les ports sont fermés par une chaîne de pare-feu dédiée branchée sur `DOCKER-USER`. Elle ne filtre que ce qui arrive d'Internet, sur les ports listés.
- **Ports de Manageo protégés** : 4000, 8081 et 3003 sont refusés par le script s'ils apparaissent dans la liste.
- **Vérification de Manageo avant et après chaque étape** : le site `manageo.site` répond, et son API joint toujours Internet (paiements, mails, SMS). Sinon, l'étape est annulée aussitôt.
- **Filet anti-blocage SSH** : `ufw` se désactive tout seul après 10 minutes si tu ne confirmes pas que SSH marche encore.
- **Retour arrière total** en une commande : `--annuler`.

## Marche à suivre

Depuis ton Mac, qui a la clé SSH du VPS. Garde la première fenêtre ouverte jusqu'à la fin.

1. Se connecter au serveur :
   ```bash
   ssh root@<IP du VPS>
   ```
2. Télécharger le script sur le serveur :
   ```bash
   curl -fsSL -o /root/securiser-vps.sh https://raw.githubusercontent.com/kass-6910/J.A.R.V.I.S/main/deploy/securiser-vps.sh && chmod +x /root/securiser-vps.sh
   ```
3. Simulation (ne change rien, montre ce qui sera fait) :
   ```bash
   /root/securiser-vps.sh
   ```
   Vérifier la liste des « services de la machine ouverts sur Internet » : tout ce qui n'est ni SSH, ni 80, ni 443 sera refusé par `ufw`.
4. Application :
   ```bash
   /root/securiser-vps.sh --appliquer
   ```
5. Dans une **deuxième** fenêtre du Mac, vérifier que SSH marche toujours :
   ```bash
   ssh root@<IP du VPS>
   ```
6. Si oui, dans la première fenêtre :
   ```bash
   /root/securiser-vps.sh --confirmer
   ```
   Sinon, ne rien faire : `ufw` se coupe tout seul au bout de 10 minutes.
7. Contrôle depuis le Mac : `nc -zv <IP du VPS> 5432` doit échouer, et https://manageo.site doit s'ouvrir normalement.

Pour tout annuler :

```bash
/root/securiser-vps.sh --annuler
```

## Ce qui a été testé

Hors du VPS, dans l'environnement de développement :

- la simulation complète ;
- l'application réelle des règles de pare-feu sur une chaîne `DOCKER-USER` (iptables en mode nftables, comme sur Ubuntu récent) ;
- l'idempotence (relancer ne crée aucun doublon) ;
- le retour arrière ;
- le script relancé à chaque démarrage par systemd.

Non testé faute de pouvoir le faire hors du VPS : `ufw` lui-même et les vérifications de Manageo, qui ne tournent qu'avec le vrai serveur.
