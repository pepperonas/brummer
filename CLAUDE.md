# CLAUDE.md

Hinweise für Claude Code beim Arbeiten in diesem Repo.

## Was das ist

**Beißfest** — Online-Arenaspiel für 2–8 Spieler, gebaut aus acht Sprite-Blättern
des Hundes Tyson. Live: https://beissfest.celox.io · Repo: `pepperonas/beissfest`
(öffentlich). VPS `69.62.121.168`, systemd `beissfest`, **Port 4263** (loopback).

## Aufbau in einem Satz

`shared/sim.js` ist die Simulation und läuft im Server **und** im Client; der
Server ist autoritativ, der Client sagt seine eigene Figur voraus und
interpoliert die anderen.

```
artwork/   8 Original-JPEGs (v4 und v5 sind byte-identisch -> 7 verschiedene)
tools/     Pipeline: cut_sprites.py -> cut_props.py -> pack_atlas.py, sprite-lab.html
shared/    sim.js  -- EINZIGE Quelle der Spielphysik
server/    index.js (HTTP+WS) · room.js (Arena) · bots.js · db.js
client/    Canvas2D + Vite, kein Framework
system/    systemd-Units, nginx-vhost, Sicherungsskript
```

## Regeln, die man nicht brechen darf

**`shared/sim.js` muss deterministisch bleiben.** Kein `Math.random()`, kein
`Date.now()`, kein DOM. Sobald Server und Client dort auseinanderlaufen, ruckelt
die eigene Figur bei jedem Schnappschuss. `sim.test.js` pinnt das mit einem
Determinismus-Test; gemessene Abweichung im Betrieb: **0,3 Welteinheiten**.

**Treffer werden nur serverseitig geprüft.** Der Client schickt ausschließlich
Eingaben. `setInput` klemmt Richtungswerte und Tastenmaske — ein manipulierter
Client wird davon nicht schneller (Test vorhanden).

**Netz-IDs sind Slots (0–7), keine internen IDs.** Sonst bläht sich der
30-Hz-Strom auf: mit String-IDs waren es 1673 B je Schnappschuss, mit Slots
565 B bei acht Spielern. Ein Test verbietet interne IDs im Netzverkehr.

**Bots sind keine Sonderwege.** Sie erzeugen nur Eingaben und laufen durch
dasselbe `stepPlayer`. Ein Bot kann damit nichts, was ein Spieler nicht auch
könnte.

## Fallen, in die ich schon getappt bin

**`[hidden]` verliert gegen explizites `display`.** `#menu`, `#over` und
`#touch` setzen `display: grid` — ohne die Regel `[hidden]{display:none
!important}` ganz oben in `style.css` bleibt das Rundenende-Overlay dauerhaft
über dem Menü stehen. Genau so passiert.

**NaN in der Kamera ist unheilbar.** `follow()` lief vor dem ersten `resize()`,
also war `vw` undefiniert, der Zoom NaN und die Klemmung machte `cam.x`
dauerhaft zu NaN — das Bild blieb leer grün. Zwei Fehler in einem: falsche
Reihenfolge *und* fehlende Absicherung. Beides ist jetzt drin
(`if (!this.vw) this.resize()` plus `Number.isFinite`-Rückfall).

**Die Rundentabelle braucht den Spielercode.** `recordRound` überspringt jeden
Eintrag ohne `code` — im ersten Deploy blieb die Bestenliste deshalb leer,
obwohl Runden zu Ende liefen. Der DB-Test konnte es nicht sehen, weil er den
Code selbst übergibt; die Lücke lag in der Verdrahtung. Jetzt gepinnt, und der
Pin wurde durch Mutation geprüft.

**Der Spawnpunkt IST die eigene Hütte.** Ein Knochen dort wird im selben Takt
gutgeschrieben. Das ist Absicht (natürliche Knochen fallen nie dorthin,
`freeSpot` hält 220 Einheiten Abstand) — aber Tests müssen den Hund erst ins
Feld stellen, sonst prüfen sie das Falsche.

**Kamera passt die HÖHE, nicht die Breite.** Die Arena ist 2,45:1; eine
Breiten-Passung ließ auf jedem normalen Bildschirm tote Bänder oben und unten.

**nginx auf dem VPS ist 1.24** → `listen 443 ssl http2;`, nicht `http2 on;`.
Und `/ws` braucht `proxy_read_timeout 3600s`, sonst fliegen ruhige Spieler
nach 60 s raus.

## Grafik

**Die Blätter sind Posen, keine Zyklen.** Gemessen an der Rückenhöhe über der
Bodenlinie zerfallen sie in zwei Gangarten: „aufrecht" (144–155 px) und
„geduckt" (124–134 px). Mischt man sie, pumpt der Hund mit dem Kopf. Getrennt
ergeben sie einen 5-Frame-Laufzyklus mit **3 px Streuung** (`walk0..4`) und einen
Schleichgang (`prowl0..3`), der jetzt das Tragen darstellt.

**Freistellen:** Flutfüllung von den Rändern, nie global — sonst Löcher im Hund.
Gezeichnete Bodenschatten überleben die Füllung und werden über
„hell UND grün-dominant" entfernt; das Fell ist neutral, deshalb trifft die
Kombination nur Schatten. Der Inselfilter (`MIN_PART = 0.90`) lässt nur den Hund
stehen — Staub und Speedlines macht die Engine, das ist steuerbarer.

**Atlas ohne Dithering quantisieren** (220 Farben, 709 → 170 kB). *Mit* Dithering
rauscht das schwarze Fell sichtbar.

Nach jeder Änderung an der Pipeline: `tools/sprite-lab.html` öffnen und die
**Zwiebelhaut** ansehen — wandert der Rücken, stimmt die Ausrichtung nicht.

## Arbeiten

```bash
cd server && npm test          # 41 Tests
cd server && npm start         # Port 4263
cd client && npm run dev       # Port 5180, leitet /api + /ws weiter
./deploy.sh                    # Tests -> Build -> rsync -> Neustart -> Probe
```

`window.__bf` gibt im Browser Zugriff auf `net`, `renderer` und `input` —
darüber laufen die Browser-Messungen (Drift, Kamera, Ereignisse).

**Neue Tests einmal mutieren.** Ein Test, den man nicht hat scheitern sehen, ist
keine Zusicherung — beim Bestenlisten-Fehler war genau das der Nachweis.
