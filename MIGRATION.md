# Umzug Beißfest → Brummer

Stand 2026-08-19. Ordner, Repo-Inhalt und alle Dateien sind bereits umgestellt;
**auf dem VPS läuft noch der alte Stand.** Diese Liste stellt ihn um. Jeder
Schritt ist einzeln prüfbar — nicht blind durchlaufen lassen.

Ausgangslage live: Dienst `beissfest`, User `beissfest`, `/opt/beissfest`,
DB `/opt/beissfest/data/beissfest.db`, vhost + Zertifikat `beissfest.celox.io`,
Timer `beissfest-backup`. Ziel: dasselbe unter `brummer`, alter Name als 301.

⚠️ **Alter und neuer Dienst teilen sich Port 4263.** Der alte muss gestoppt
sein, bevor der neue startet — sonst bindet der neue nicht und `deploy.sh`
meldet nur, dass `/api/health` nicht antwortet.

⚠️ **`/opt/beissfest` und `/var/backups/beissfest` bleiben stehen**, bis das
neue Ziel nachweislich läuft. Sie sind der Rollback.

---

## 0. GitHub

Repo `pepperonas/beissfest` in den Einstellungen auf **`brummer`** umbenennen
(GitHub legt selbst eine Weiterleitung an), danach lokal:

```bash
git remote set-url origin https://github.com/pepperonas/brummer.git
git remote -v
```

## 1. DNS

A-Record `brummer.celox.io` → `69.62.121.168`. Entweder im Hostinger-Panel oder
per API von raspi5 aus (der Bearer-Token liegt dort in
`/root/.acme.sh/account.conf`, er verlässt raspi5 nicht). Erst weitermachen,
wenn das hier antwortet:

```bash
dig +short brummer.celox.io      # -> 69.62.121.168
```

## 2. Benutzer und Verzeichnisse

```bash
ssh root@69.62.121.168 'adduser --system --group --home /opt/brummer brummer &&
  mkdir -p /opt/brummer/data && chown -R brummer:brummer /opt/brummer'
```

## 3. Zertifikat holen (VOR dem vollen vhost)

Der fertige vhost verweist auf Zertifikatsdateien, die es noch nicht gibt —
`nginx -t` scheitert daran. Deshalb erst nur den **:80-Block** aus
`system/brummer.celox.io.conf` einspielen, Zertifikat holen, dann die volle
Datei aktivieren.

```bash
scp system/brummer.celox.io.conf root@69.62.121.168:/root/brummer.vhost
ssh root@69.62.121.168 'sed -n "1,/^}/p" /root/brummer.vhost \
    > /etc/nginx/sites-available/brummer.celox.io &&
  ln -sf /etc/nginx/sites-available/brummer.celox.io /etc/nginx/sites-enabled/ &&
  nginx -t && systemctl reload nginx &&
  certbot certonly --nginx -d brummer.celox.io &&
  cp /root/brummer.vhost /etc/nginx/sites-available/brummer.celox.io &&
  nginx -t && systemctl reload nginx'
```

> nginx ist hier **1.24** → `listen 443 ssl http2;`. Steht in der Vorlage
> schon richtig, aber nicht auf `http2 on;` „korrigieren".

## 4. Datenbank übernehmen

`sqlite3 .backup` statt `cp` — die DB läuft im WAL-Modus.

```bash
ssh root@69.62.121.168 'systemctl stop beissfest &&
  sqlite3 /opt/beissfest/data/beissfest.db ".backup '"'"'/opt/brummer/data/brummer.db'"'"'" &&
  sqlite3 /opt/brummer/data/brummer.db "PRAGMA integrity_check;" &&
  chown brummer:brummer /opt/brummer/data/brummer.db &&
  sqlite3 /opt/brummer/data/brummer.db "SELECT count(*) FROM players;"'
```

Die letzte Zahl ist die Probe: sie muss zur alten Bestenliste passen.

## 5. Units installieren

```bash
scp system/brummer.service system/brummer-backup.service system/brummer-backup.timer \
    root@69.62.121.168:/etc/systemd/system/
scp system/brummer-backup.sh root@69.62.121.168:/usr/local/sbin/brummer-backup.sh
ssh root@69.62.121.168 'chmod 755 /usr/local/sbin/brummer-backup.sh &&
  systemctl daemon-reload && systemctl enable brummer brummer-backup.timer'
```

## 6. Ausrollen

```bash
./deploy.sh          # Tests -> Build -> rsync -> Neustart -> /api/health
```

## 7. Alten Stand stilllegen und umleiten

Erst wenn Schritt 6 grün war. Der alte vhost behält sein Zertifikat — ohne das
läuft der Redirect in einen TLS-Fehler statt auf die neue Adresse.

```bash
ssh root@69.62.121.168 'systemctl disable --now beissfest beissfest-backup.timer'
```

Im vhost `/etc/nginx/sites-available/beissfest.celox.io` beide `location`-Blöcke
des :443-Servers ersetzen durch:

```nginx
location / { return 301 https://brummer.celox.io$request_uri; }
```

Dann `nginx -t && systemctl reload nginx`.

## 8. Probe

```bash
curl -s https://brummer.celox.io/api/health          # {"ok":true,...}
curl -s https://brummer.celox.io/api/leaderboard     # nicht leer
curl -sI https://beissfest.celox.io/ | head -3       # 301 auf brummer
```

Dazu einmal im Browser: Runde starten, Knochen abliefern, Rundenende abwarten,
danach `/api/leaderboard` erneut — die Punkte müssen gestiegen sein.

## 9. Aufräumen (frühestens nach ein paar Tagen)

`/opt/beissfest`, `/var/backups/beissfest`, die alten Unit-Dateien und der
Benutzer `beissfest`. Solange sie liegen, ist ein Rückzug möglich: alten Dienst
starten, neuen stoppen, vhosts tauschen.

---

## Was Spieler merken

Der Spielercode liegt im `localStorage` und der hängt an der Adresse — nach dem
Umzug ist er auf `brummer.celox.io` **nicht** mehr da. Wer seinen sechsstelligen
Code kennt, trägt ihn im Menü ein und hat seine Statistik zurück; alle anderen
fangen bei null an. Die Daten selbst gehen nicht verloren, sie hängen am Code.
