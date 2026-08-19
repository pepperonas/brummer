#!/bin/bash
# Naechtliche Sicherung der Spielerdatenbank.
# sqlite3 .backup statt cp: die DB laeuft im WAL-Modus, eine Kopie erwischt
# sonst einen halben Schreibvorgang.
set -euo pipefail
SRC=/opt/beissfest/data/beissfest.db
DST=/var/backups/beissfest
KEEP=30
mkdir -p "$DST"
[ -f "$SRC" ] || { echo "keine Datenbank unter $SRC"; exit 0; }
STAMP=$(date +%F)
sqlite3 "$SRC" ".backup '$DST/beissfest-$STAMP.db'"
sqlite3 "$DST/beissfest-$STAMP.db" "PRAGMA integrity_check;" | grep -q '^ok$' \
  || { echo "Integritaetspruefung fehlgeschlagen"; rm -f "$DST/beissfest-$STAMP.db"; exit 1; }
gzip -f "$DST/beissfest-$STAMP.db"
ls -1t "$DST"/beissfest-*.db.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
echo "gesichert: $DST/beissfest-$STAMP.db.gz"
