#!/bin/bash
# Sauvegarde de Jarvis : base de données et fichiers (factures, vêtements, cours).
# À lancer chaque nuit par cron, depuis le dossier de Jarvis :
#   15 3 * * * cd /opt/jarvis && ./deploy/backup.sh >> /var/log/jarvis-backup.log 2>&1
set -euo pipefail

DEST="${JARVIS_BACKUP_DIR:-/root/jarvis-backups}"
KEEP_DAYS="${JARVIS_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

docker exec jarvis-postgres pg_dump -U jarvis jarvis | gzip > "$DEST/jarvis_${STAMP}.sql.gz"
tar -czf "$DEST/jarvis_data_${STAMP}.tar.gz" -C "$(pwd)" data

find "$DEST" -name 'jarvis_*' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Iseconds) sauvegarde faite : $DEST/jarvis_${STAMP}.sql.gz"
