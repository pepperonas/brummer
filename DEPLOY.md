# Ausrollen

Zielsystem: VPS `69.62.121.168`, nginx als reiner Vermittler, ein systemd-Dienst.
Es gibt **kein zweites Webroot** — der Client wird aus demselben Node-Prozess
ausgeliefert wie die API.

## Einmalig

```bash
# Port: NICHT annehmen, pruefen. 4242-4262 sind belegt.
ssh root@69.62.121.168 'ss -tlnp | grep -oE "127.0.0.1:4[0-9]{4}" | sort -u'
# -> brummer laeuft auf 4263

ssh root@69.62.121.168 'adduser --system --group --home /opt/brummer brummer'
```

nginx-vhost `/etc/nginx/sites-available/brummer.celox.io` (Vorlage in
`system/brummer.celox.io.conf`), dann:

```bash
ln -s /etc/nginx/sites-available/brummer.celox.io /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot certonly --nginx -d brummer.celox.io
```

> ⚠️ nginx ist hier **1.24**. Dort gilt `listen 443 ssl http2;` — das neuere
> `http2 on;` gibt es erst ab 1.25 und laesst die Konfiguration platzen.

> ⚠️ Der WebSocket braucht `proxy_read_timeout 3600s`, sonst trennt nginx
> ruhige Verbindungen nach 60 s.

## Bei jeder Aenderung

```bash
./deploy.sh
```

Das Skript baut den Client, spiegelt `server/`, `shared/` und den Build, laesst
`npm install --omit=dev` laufen (better-sqlite3 wird nativ gebaut) und startet
den Dienst neu.

## Nachsehen

```bash
ssh root@69.62.121.168 'systemctl status brummer --no-pager'
ssh root@69.62.121.168 'journalctl -u brummer -f'
curl -s https://brummer.celox.io/api/health
```

## Sicherung

`brummer-backup.timer` sichert `brummer.db` naechtlich um 03:40 nach
`/var/backups/brummer/` (30 Staende). Gesichert wird ueber `sqlite3 .backup`,
**nicht** per `cp` — die Datenbank laeuft im WAL-Modus, eine Kopie erwischt
sonst einen halben Schreibvorgang.
