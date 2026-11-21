#!/bin/bash
# Sécurisation du VPS partagé (phase 3 de docs/DURCISSEMENT-VPS.md, dépôt Manageo), sans toucher à Manageo.
#
#   sudo ./securiser-vps.sh                 simulation : montre ce qui serait fait, ne change rien
#   sudo ./securiser-vps.sh --appliquer     applique (avec vérifications et retour arrière automatique)
#   sudo ./securiser-vps.sh --confirmer     garde le pare-feu ufw (annule le retour arrière programmé)
#   sudo ./securiser-vps.sh --annuler       retire tout ce que ce script a mis en place
#
# Ce que fait le script :
#   1. Ferme à Internet les ports Docker d'autres projets (liste PORTS_A_FERMER), par une chaîne
#      dédiée branchée sur DOCKER-USER. Aucun docker-compose.yml modifié, aucun conteneur redémarré :
#      les applications du serveur et nginx continuent de joindre ces ports en local.
#   2. Rend la règle permanente (service systemd relancé avec Docker).
#   3. Active ufw : entrées refusées sauf SSH, 80 et 443. Retour arrière automatique dans 10 minutes
#      sans « --confirmer », contre tout risque de perdre l'accès SSH.
#
# Ce que le script ne touche jamais : Manageo (ses conteneurs, ses ports, son nginx, sa base),
# ni aucun fichier des autres projets. Les ports de Manageo sont refusés s'ils apparaissent dans la liste.
#
# Rouvrir un port plus tard : le retirer de PORTS_A_FERMER, puis relancer avec --appliquer.

set -euo pipefail

# --- Réglages ----------------------------------------------------------------

# Ports Docker publiés sur Internet par d'autres projets (inventaire du 30/10/2026).
#   5432 managouss-postgres, 5434 3proj-postgres : bases de données, à fermer en priorité.
#   3000 portfolio (servi par nginx sur kassdev.fr), 3001 managouss-backend,
#   3010 et 5173 3proj, 82 tryfit, 83 site lmdd (ne seront plus joignables en IP:port).
PORTS_A_FERMER=(5432 5434 3000 3001 3010 5173 82 83)

# Ports de Manageo : le script refuse de les filtrer (ils sont déjà réservés à la machine elle-même).
PORTS_MANAGEO=(4000 8081 3003)

# Vérifications de Manageo avant et après chaque étape.
MANAGEO_URL="https://manageo.site"
MANAGEO_BACKEND_CONTAINER="managyo-360-backend"

CHAINE="VPS-PORTS-FERMES"
SERVICE="/etc/systemd/system/vps-ports-fermes.service"
SCRIPT_INSTALLE="/usr/local/sbin/vps-ports-fermes"
DELAI_RETOUR_ARRIERE="10min"

# --- Outils --------------------------------------------------------------------

MODE="${1:-simulation}"
SIMULATION=1
if [ "$MODE" = "--appliquer" ]; then SIMULATION=0; fi

info() { echo "  $*"; }
etape() { echo; echo "== $*"; }
erreur() { echo "ERREUR : $*" >&2; exit 1; }

faire() {
  if [ "$SIMULATION" = 1 ]; then
    echo "  [simulation] $*"
  else
    "$@"
  fi
}

[ "$(id -u)" = 0 ] || erreur "à lancer avec sudo."

interface_externe() {
  ip route show default | awk '{print $5; exit}'
}

port_ssh() {
  local port
  port="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
  echo "${port:-22}"
}

# Manageo répond-il, et son API joint-elle encore Internet ? Renvoie 0 si tout va bien.
verifier_manageo() {
  local code ok=0
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$MANAGEO_URL/" || true)"
  code="${code:-000}"
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
    info "Manageo : le site répond ($code)."
  else
    info "Manageo : le site ne répond pas correctement ($code)."
    ok=1
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MANAGEO_BACKEND_CONTAINER"; then
    if docker exec "$MANAGEO_BACKEND_CONTAINER" node -e \
      "fetch('https://www.google.com',{signal:AbortSignal.timeout(10000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
      info "Manageo : l'API joint toujours Internet (paiements, mails, SMS)."
    else
      info "Manageo : l'API ne joint plus Internet."
      ok=1
    fi
  else
    info "Manageo : conteneur $MANAGEO_BACKEND_CONTAINER introuvable, vérification de sortie Internet sautée."
  fi
  return $ok
}

# --- Fermeture des ports Docker --------------------------------------------------

controler_liste() {
  for port in "${PORTS_A_FERMER[@]}"; do
    for m in "${PORTS_MANAGEO[@]}"; do
      if [ "$port" = "$m" ]; then
        erreur "le port $port appartient à Manageo : retire-le de PORTS_A_FERMER."
      fi
    done
  done
}

# Règles de la chaîne dédiée : on filtre le port d'origine (avant la traduction de Docker),
# uniquement pour ce qui arrive par l'interface Internet.
regles_ports() {
  local ext="$1"
  for port in "${PORTS_A_FERMER[@]}"; do
    echo "-A $CHAINE -i $ext -p tcp -m conntrack --ctorigdstport $port --ctdir ORIGINAL -j DROP"
  done
}

appliquer_ports() {
  local ext="$1"
  iptables -N "$CHAINE" 2>/dev/null || iptables -F "$CHAINE"
  while read -r regle; do
    # shellcheck disable=SC2086
    iptables $regle
  done < <(regles_ports "$ext")
  iptables -A "$CHAINE" -j RETURN
  iptables -N DOCKER-USER 2>/dev/null || true
  iptables -C DOCKER-USER -j "$CHAINE" 2>/dev/null || iptables -I DOCKER-USER 1 -j "$CHAINE"
}

retirer_ports() {
  while iptables -C DOCKER-USER -j "$CHAINE" 2>/dev/null; do iptables -D DOCKER-USER -j "$CHAINE"; done
  iptables -F "$CHAINE" 2>/dev/null || true
  iptables -X "$CHAINE" 2>/dev/null || true
}

installer_service() {
  local ext="$1"
  # Copie autonome du script, relancée par systemd avec Docker (les règles iptables ne survivent pas au redémarrage).
  cat > "$SCRIPT_INSTALLE" <<EOS
#!/bin/bash
# Généré par securiser-vps.sh : ferme à Internet les ports Docker des autres projets (pas Manageo).
set -e
iptables -N $CHAINE 2>/dev/null || iptables -F $CHAINE
$(regles_ports "$ext" | sed 's/^/iptables /')
iptables -A $CHAINE -j RETURN
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -j $CHAINE 2>/dev/null || iptables -I DOCKER-USER 1 -j $CHAINE
EOS
  chmod 700 "$SCRIPT_INSTALLE"
  cat > "$SERVICE" <<EOS
[Unit]
Description=Ports Docker des autres projets fermés à Internet (securiser-vps.sh)
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=$SCRIPT_INSTALLE
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target docker.service
EOS
  systemctl daemon-reload
  systemctl enable vps-ports-fermes.service >/dev/null
}

# --- Pare-feu ufw ---------------------------------------------------------------------

appliquer_ufw() {
  local ssh="$1"
  command -v ufw >/dev/null || apt-get install -y ufw
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "$ssh/tcp" comment "SSH"
  ufw allow 80/tcp comment "HTTP (nginx)"
  ufw allow 443/tcp comment "HTTPS (nginx)"
  if ip link show tailscale0 >/dev/null 2>&1; then
    ufw allow in on tailscale0 comment "Tailscale"
  fi
  ufw --force enable
  # Filet de sécurité : sans « --confirmer », ufw se désactive tout seul.
  systemctl stop ufw-retour-arriere.timer ufw-retour-arriere.service 2>/dev/null || true
  systemctl reset-failed ufw-retour-arriere.service 2>/dev/null || true
  systemd-run --unit=ufw-retour-arriere --on-active="$DELAI_RETOUR_ARRIERE" /usr/sbin/ufw disable >/dev/null
}

# --- Déroulé ------------------------------------------------------------------------

case "$MODE" in
  --confirmer)
    systemctl stop ufw-retour-arriere.timer 2>/dev/null || true
    systemctl stop ufw-retour-arriere.service 2>/dev/null || true
    echo "ufw est gardé. Retour arrière automatique annulé."
    ufw status verbose
    exit 0
    ;;
  --annuler)
    retirer_ports
    systemctl disable --now vps-ports-fermes.service 2>/dev/null || true
    rm -f "$SERVICE" "$SCRIPT_INSTALLE"
    systemctl daemon-reload
    ufw disable 2>/dev/null || true
    echo "Tout est retiré : ports rouverts comme avant, ufw désactivé."
    exit 0
    ;;
  simulation | --appliquer) ;;
  *) erreur "option inconnue : $MODE (voir l'en-tête du script)." ;;
esac

controler_liste
EXT="$(interface_externe)"
SSH="$(port_ssh)"
[ -n "$EXT" ] || erreur "interface Internet introuvable."

etape "État de départ"
info "Interface Internet : $EXT ; port SSH : $SSH."
info "Ports à fermer à Internet : ${PORTS_A_FERMER[*]} (Manageo exclu : ${PORTS_MANAGEO[*]})."
info "Services de la machine elle-même ouverts sur Internet (hors Docker), qui seront refusés par ufw :"
ss -tlnpH 2>/dev/null | awk '{print $4, $6}' | grep -vE '^(127\.|\[::1\]|localhost)' | grep -v docker-proxy | sed "s/^/    /" || true
info "(les ports de Docker, gérés à l'étape 1, ne sont pas concernés par ufw)"
verifier_manageo || [ "$SIMULATION" = 1 ] || erreur "Manageo ne répond pas correctement AVANT toute modification : rien n'est fait."

etape "1. Fermeture des ports Docker des autres projets"
if [ "$SIMULATION" = 1 ]; then
  regles_ports "$EXT" | sed 's/^/  [simulation] iptables /'
else
  appliquer_ports "$EXT"
  sleep 2
  if ! verifier_manageo; then
    retirer_ports
    erreur "Manageo est affecté : fermeture des ports annulée, rien n'a changé."
  fi
  installer_service "$EXT"
  info "Ports fermés, règle rendue permanente (service vps-ports-fermes)."
fi

etape "2. Pare-feu ufw (SSH $SSH, 80, 443)"
if [ "$SIMULATION" = 1 ]; then
  faire ufw default deny incoming
  faire ufw allow "$SSH/tcp"
  faire ufw allow 80/tcp
  faire ufw allow 443/tcp
  faire ufw --force enable
  faire systemd-run --on-active="$DELAI_RETOUR_ARRIERE" ufw disable
else
  appliquer_ufw "$SSH"
  sleep 2
  if ! verifier_manageo; then
    ufw disable
    erreur "Manageo est affecté : ufw désactivé aussitôt. Les ports Docker restent fermés (étape 1 vérifiée)."
  fi
fi

etape "Fini"
if [ "$SIMULATION" = 1 ]; then
  echo "  Simulation seulement : rien n'a changé. Relancer avec --appliquer."
else
  cat <<EOF
  Ports fermés et ufw actif. Manageo répond normalement.

  Dans une DEUXIÈME fenêtre, sans fermer celle-ci, vérifie que SSH marche toujours :
      ssh root@<IP du VPS>
  Si oui :   sudo $0 --confirmer
  Sinon, ne fais rien : ufw se désactive tout seul dans $DELAI_RETOUR_ARRIERE.
EOF
fi
