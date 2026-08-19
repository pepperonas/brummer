#!/bin/bash
# Beissfest ausrollen. Baut den Client, spiegelt Server + geteilte Simulation,
# startet den Dienst neu und prueft, dass er wirklich antwortet.
set -euo pipefail
HOST=${HOST:-root@69.62.121.168}
DIR=/opt/beissfest

echo "==> Tests"
( cd server && npm test --silent >/dev/null ) && echo "    Suite gruen"

echo "==> Client bauen"
( cd client && npm run build >/dev/null )

echo "==> Uebertragen"
ssh "$HOST" "mkdir -p $DIR/server $DIR/shared $DIR/data"
rsync -az --delete shared/ "$HOST:$DIR/shared/"
rsync -az --delete --exclude node_modules --exclude data --exclude public --exclude test \
      server/ "$HOST:$DIR/server/"
rsync -az --delete client/dist/ "$HOST:$DIR/server/public/"

echo "==> Abhaengigkeiten + Neustart"
ssh "$HOST" "cd $DIR/server && npm install --omit=dev --silent && \
             chown -R beissfest:beissfest $DIR && \
             systemctl restart beissfest && sleep 2 && systemctl is-active beissfest"

echo "==> Probe"
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 5 https://beissfest.celox.io/api/health >/dev/null 2>&1; then
    curl -s https://beissfest.celox.io/api/health; echo; echo "==> fertig"; exit 0
  fi
  sleep 2
done
echo "!! /api/health antwortet nicht -- journalctl -u beissfest -n 50" >&2
exit 1
