# Umzug Beißfest → Brummer

**Ausgeführt am 2026-08-19.** Diese Liste ist damit Protokoll, nicht mehr
Anleitung — sie bleibt als Beleg und als Vorlage für den nächsten Umzug stehen.
Was beim echten Lauf anders war als geplant, steht unten unter
„Abweichungen beim Lauf".

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

## 9. Aufräumen — ERLEDIGT am 2026-08-21

Der Rollback ist abgebaut, ein Rückzug auf `beissfest` ist ab jetzt **nicht mehr
möglich**. Entfernt wurden:

- `/opt/beissfest` (15 MB) und `/var/backups/beissfest`
- die Units `beissfest.service`, `beissfest-backup.{service,timer}` + `daemon-reload`
- vhost `beissfest.celox.io` (sites-available + sites-enabled), `nginx -t` + reload
- das Let's-Encrypt-Zertifikat (`certbot delete`, live/archive/renewal)
- der Systembenutzer `beissfest` (uid 116) samt Gruppe

**Vor dem Löschen wurde die Datenübernahme geprüft**, nicht angenommen: die alte
DB hielt 5 Spieler und 16 Runden, die neue 13 und 40. Alle 5 alten Spielercodes
stehen mit identischen Werten (games/wins/score) in `brummer.db`, und die 16
alten Runden sind zeilenweise bit-identisch (gleicher md5 über das Dump-Ergebnis).
In der alten DB stand also nichts Eigenes.

⚠️ **Beim Prüfen der Spieler nicht über `id` gehen** — der Primärschlüssel heißt
`code`. Ein `select id from players` scheitert, und wenn man das Ergebnis mit
`comm` gegen ein zweites ebenso gescheitertes Ergebnis hält, vergleicht man zwei
leere Listen und bekommt ein falsches „keine Abweichung".

⚠️ **`pgrep -f`/`pkill -f` finden sich selbst.** Ein Warte-Skript, das mit
`pgrep -f "certbot -q renew"` auf das Ende des Renewal-Laufs lauert, matcht jede
andere Shell, deren *Kommandozeile* diese Zeichenkette enthält — also auch einen
zweiten Warter und die eigene `bash -c`-Hülle. Hier warteten dadurch zwei
Prozesse gegenseitig aufeinander, und ein `pkill -f <skriptname>` erlegte die
eigene SSH-Sitzung (Exit 255). Bei solchen Wächtern über **PID** arbeiten oder
mit `pgrep -x` auf den Programmnamen.

Nebenbefund, unabhängig von dieser Migration: `certbot.service` steht auf
`failed`, aber wegen `hus-vorschau.celox.io` („Some challenges have failed",
zuletzt 2026-08-20 16:00 und 2026-08-21 02:13). Das beissfest-Zertifikat war an
den Fehlschlägen nie beteiligt — es hatte noch 87 Tage Restlaufzeit und stand
damit gar nicht zur Erneuerung an.

---

## Abweichungen beim Lauf (2026-08-19)

Zwei Punkte stimmten nicht mit der Wirklichkeit überein.

**1. Der alte Name hat keinen DNS-Eintrag mehr — Schritt 7/8 (301) entfiel.**
Der Hostinger-Record wurde offenbar *umbenannt* statt dupliziert:
`brummer.celox.io` löste schon vor Beginn auf 69.62.121.168 auf, während
`beissfest.celox.io` bei den autoritativen Nameservern (`ns1.dns-parking.com`)
**gar keinen A-Record** mehr hat. Ein 301 dort wäre für niemanden erreichbar,
also wurde er weggelassen; der alte vhost bleibt vorerst nur als Rollback
stehen. Folge: alte Lesezeichen laufen in NXDOMAIN statt auf die neue Adresse.
Wer das nachholen will, braucht **erst wieder einen A-Record**, dann den 301.

Nebenwirkung: das Zertifikat `beissfest.celox.io` (gültig bis **16.11.2026**)
konnte sich ohne DNS nicht mehr per HTTP-01 erneuern. Kein Schaden — und es kam
nie zu den erwarteten Erneuerungsfehlern, weil §9 am 2026-08-21 vorgezogen
wurde und das Zertifikat mitgenommen hat.

**2. `systemctl enable` startet einen Timer nicht.** Schritt 5 armiert
`brummer-backup.timer` nur für den nächsten Boot; `systemctl list-timers` zeigte
ihn danach nicht. Ohne ein zusätzliches

```bash
systemctl start brummer-backup.timer
```

wäre die erste nächtliche Sicherung stillschweigend ausgefallen. Der Lauf wurde
danach einmal von Hand ausgelöst und die Sicherung nachweislich erzeugt
(`/var/backups/brummer/brummer-2026-08-19.db.gz`, Integritätsprüfung im Skript).

**Nicht abgewichen, aber bestätigt:** die Haupt-DB war 4 KB groß, der WAL
383 KB — ein `cp` hätte eine praktisch leere Datenbank kopiert. `.backup` hat
alle 5 Spieler und 16 Runden übernommen, `integrity_check` = ok.

### Belege der Abnahme

* `/api/health` → `{"ok":true,...}`, `/api/leaderboard` trägt die alten Stände
  (RundenTest 23, Tyson 20).
* WebSocket über nginx: `hello` + `meta` (3 Bots aufgefüllt), **180
  Schnappschüsse in 6 s = exakt 30 Hz**, rtt 27 ms.
* Browser: Menü sichtbar, Rundenende-Overlay korrekt verborgen, Kamera endlich
  (x 538,8 · y 625 · zoom 1,114 — kein NaN), Canvas auf 1200×863 vermessen,
  Phase `play`, 8 Knochen / 5 Depots, **0 Konsolenfehler**.
* Kopfzeilen: `index.html` `no-cache`, gehashtes Bundle `immutable`.
* Die beiden Probe-Konten (`DeployProbe`, `Tyson/XV9ZBR`) wurden danach wieder
  aus `players` entfernt — die Bestenliste steht unverändert bei 5 Einträgen.

---

## Was Spieler merken

Der Spielercode liegt im `localStorage` und der hängt an der Adresse — nach dem
Umzug ist er auf `brummer.celox.io` **nicht** mehr da. Wer seinen sechsstelligen
Code kennt, trägt ihn im Menü ein und hat seine Statistik zurück; alle anderen
fangen bei null an. Die Daten selbst gehen nicht verloren, sie hängen am Code.
