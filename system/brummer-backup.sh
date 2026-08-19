#!/bin/bash
# Naechtliche Sicherung der Spielerdatenbank.
# sqlite3 .backup statt cp: die DB laeuft im WAL-Modus, eine Kopie erwischt
# sonst einen halben Schreibvorgang.
set -euo pipefail
SRC=/opt/brummer/data/brummer.db
DST=/var/backups/brummer
KEEP=30
mkdir -p "$DST"
[ -f "$SRC" ] || { echo "keine Datenbank unter $SRC"; exit 0; }
STAMP=$(date +%F)
sqlite3 "$SRC" ".backup '$DST/brummer-$STAMP.db'"
sqlite3 "$DST/brummer-$STAMP.db" "PRAGMA integrity_check;" | grep -q '^ok$' \
  || { echo "Integritaetspruefung fehlgeschlagen"; rm -f "$DST/brummer-$STAMP.db"; exit 1; }
gzip -f "$DST/brummer-$STAMP.db"
ls -1t "$DST"/brummer-*.db.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
echo "gesichert: $DST/brummer-$STAMP.db.gz"
