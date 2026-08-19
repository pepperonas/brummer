# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

**Brummer** — Online-Arenaspiel für 2–8 Spieler, gebaut aus acht Sprite-Blättern
des Hundes Tyson. Live: https://brummer.celox.io · Repo: `pepperonas/brummer`
(öffentlich). VPS `69.62.121.168`, systemd `brummer`, **Port 4263** (loopback).

**Umbenannt am 2026-08-19** (vorher „Beißfest", `beissfest.celox.io`) — die
Umstellung ist **vollzogen**: Repo, DNS, Zertifikat, Dienst, Datenbank und
Sicherungstimer laufen unter dem neuen Namen, der alte Dienst ist gestoppt und
`disable`d. Der Weg dahin steht in **`MIGRATION.md`**.

⚠️ **Der alte Name ist NICHT umgeleitet, sondern weg.** Der DNS-Eintrag
`beissfest.celox.io` wurde umbenannt statt dupliziert, hat also **keinen
A-Record mehr**; der geplante 301 wäre unerreichbar und ist deshalb entfallen.
Alte Lesezeichen laufen in NXDOMAIN. Wer sie einfangen will, braucht **zuerst
wieder einen A-Record** — dann erst lohnt der Redirect.

⚠️ **Rollback steht noch:** `/opt/beissfest`, `/var/backups/beissfest`, der alte
vhost samt Zertifikat und der Benutzer `beissfest`. Solange sie liegen, ist ein
Rückzug möglich. Das alte Zertifikat läuft am **16.11.2026** ab und kann sich
mangels DNS nicht mehr erneuern — spätestens dann aufräumen (MIGRATION.md §9).

## Aufbau in einem Satz

`shared/sim.js` ist die Simulation und läuft im Server **und** im Client; der
Server ist autoritativ, der Client sagt seine eigene Figur voraus und
interpoliert die anderen.

```
artwork/   8 Original-JPEGs (v4 und v5 sind byte-identisch -> 7 verschiedene)
tools/     Pipeline: cut_sprites.py -> cut_props.py -> pack_atlas.py, sprite-lab.html
shared/    sim.js  -- EINZIGE Quelle der Spielphysik
server/    index.js (HTTP+WS) · room.js (Arena) · bots.js · db.js
client/    Canvas2D + Vite, kein Framework (src/: net · render · input · main)
system/    systemd-Units, nginx-vhost, Sicherungsskript
PLAN.html  der Plan von vor dem Bau, als umgesetzt markiert (Hintergrund, keine Wahrheit)
```

## Regeln, die man nicht brechen darf

**`shared/sim.js` muss deterministisch bleiben.** Kein `Math.random()`, kein
`Date.now()`, kein DOM. Sobald Server und Client dort auseinanderlaufen, ruckelt
die eigene Figur bei jedem Schnappschuss. `sim.test.js` pinnt das mit einem
Determinismus-Test; gemessene Abweichung im Betrieb: **0,3 Welteinheiten**.
Zufall gehört in `room.js` — der Raum hat dafür einen **eigenen gesäten
xorshift** (`rnd()`), bewusst nicht `Math.random`. Das ist erlaubt, weil Knochen,
Depots und Rundenaufbau **nur** aus Schnappschüssen kommen; der Client simuliert
davon nichts.

**Treffer werden nur serverseitig geprüft.** Der Client schickt ausschließlich
Eingaben. `setInput` klemmt Richtungswerte und Tastenmaske — ein manipulierter
Client wird davon nicht schneller (Test vorhanden).

**Netz-IDs sind Slots (0–7), keine internen IDs.** Sonst bläht sich der
30-Hz-Strom auf: mit String-IDs waren es 1673 B je Schnappschuss, mit Slots
565 B bei acht Spielern. Ein Test verbietet interne IDs im Netzverkehr.

**Bots sind keine Sonderwege.** Sie erzeugen nur Eingaben und laufen durch
dasselbe `stepPlayer`. Ein Bot kann damit nichts, was ein Spieler nicht auch
könnte.

## Der Vertrag zwischen `room.js` und `net.js`

Das ist die zerbrechlichste Stelle im Repo, und sie steht in **zwei** Dateien.

**Der Schnappschuss ist positionell.** `Room.snapshot()` schreibt Arrays statt
Objekte (spart ~60 % Bytes), `Net._reconcile`/`view()` lesen sie über
**Indizes**. Ein neues Feld heißt: beide Seiten anfassen, sonst liest der Client
still den falschen Wert.

```
ps[i] = [slot, x, y, vx, vy, facing, animIdx, score, stam,
         carrying(0|1), stunT*100, lastSeq, digT/DIG.time*100, sniff(0|1)]
bs[i] = [boneId, x, y, traegerSlot | -1]      cs[i] = [cacheId, x, y]
ev    = Ereignisse dieses Takts (bite · bark · deliver · dig · grab · join · leave · round)
```

**Die Animationsliste steht doppelt** — als Map in `room.js` (`ANIM`) und als
Array in `net.js`. Die **Reihenfolge** ist der Vertrag; wer hinten anhängt, ist
sicher, wer einsortiert, vertauscht dem Client die Posen.

**Skalierte Felder werden im Client zurückgerechnet, teils mit fester Zahl.**
`stunT` fährt in Hundertsteln, `digT` als Prozent von `DIG.time`. ⚠️ `net.js`
rechnet dafür mit einer **hart notierten 2.0** statt mit `DIG.time` — wird die
Grabzeit in `sim.js` geändert, zeigt der Client den falschen Fortschritt und
sagt falsch voraus. Beide Stellen (`_reconcile`, `view`) mitziehen.

**Nachrichten.** Client → Server: `join {name, room?, code?}` · `in {dx,dy,btn,seq}`
· `ping {c}`. Server → Client: `hello {you, room, code, tickHz}` · `meta {ps}`
(Namen/Bots je Slot, nur bei Wechseln) · `s` (Schnappschuss, 30 Hz) · `pong` ·
`err`. Tastenmaske `BTN` = RUN 1 · BITE 2 · BARK 4 · NOSE 8.

**HTTP im selben Prozess:** `GET /api/health` (Räume + Menschen), `/api/leaderboard`,
`/api/me?code=`, `POST /api/register {name, code?}`; alles Übrige ist statische
Auslieferung mit SPA-Rückfall auf `index.html`. ⚠️ Die Cache-Regel in
`serveStatic` ist eine Hauslektion: gehashte Bundles `immutable`, **`index.html`
niemals** — sonst fährt der Browser nach einem Deploy stundenlang das alte
Bundle.

## Räume und Runden

Ein Raum = eine Arena = ein `Room`. **Zwei verschiedene Codes**, beide aus
demselben verwechslungsarmen Alphabet (ohne I L O 0 1) und leicht zu verwechseln:
der **Raumcode** ist 4-stellig und flüchtig (`join {room}`), der **Spielercode**
6-stellig, liegt in SQLite und im `localStorage` (`br-code`) und ist das Konto.

Schnellstart nimmt den ersten nicht vollen Raum, sonst wird einer angelegt;
ein Raum ohne Menschen wird abgeräumt (der letzte bleibt stehen). `balanceBots()`
hält **3** Bots je Raum vor, verdrängt Bots für ankommende Menschen und entfernt
bei 0 Menschen alle — ein leerer Raum soll nicht rechnen.

Rundenlauf: `play` 180 s → `over` 12 s (Auswertung, Eingaben tot) → `reset()`.
⚠️ `ROUND.warmup` ist deklariert, aber **nirgends benutzt** — es gibt keine
Aufwärmphase, wer eine erwartet, sucht vergeblich.

## Fallen, in die ich schon getappt bin

**Der Tasten-Handler hängt am Fenster und fraß jede Eingabe.** `input.js`
ruft für die Spieltasten `preventDefault()` — ohne Tor gilt das auch im
Namens- und im Code-Feld. Der Nutzer konnte seinen Hund nicht „Tyson" nennen
(das `s` ist die Lauftaste, es kam „Ty" heraus, so steht es in der
Bestenliste), und weil das Code-Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
**alle sieben** Buchstabentasten enthält — A D E F Q S W — ließen sich
**64 % der vierstelligen Arena-Codes gar nicht eintippen**: „Mit Freunden
spielen" war für zwei von drei Codes tot. Dazu verschluckte der Handler
`Cmd+W`. Fix: `isTypingTarget()` (INPUT/TEXTAREA/SELECT/contentEditable) und
ein Modifier-Tor ganz vorn im `keydown`. ⚠️ **`keyup` NICHT toren** — wer
beim Loslassen gerade ins Feld geklickt hat, behielte sonst eine ewig
gedrückte Taste. Gepinnt in `client/test/input.test.mjs` (Mutationsprobe:
ohne das Tor fallen 4 der 7 Prüfungen).

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
Code selbst übergibt; die Lücke lag in der Verdrahtung (`index.js` hängt ihn
beim `join` an den Spieler). Jetzt gepinnt, und der Pin wurde durch Mutation
geprüft.

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

**Der Atlas ist eingecheckt** (`client/public/assets/atlas.{png,json}`), die
Zwischenframes unter `build/` nicht. Die Pipeline läuft also nur, wenn sich in
`artwork/` etwas ändert — und danach: `tools/sprite-lab.html` öffnen und die
**Zwiebelhaut** ansehen; wandert der Rücken, stimmt die Ausrichtung nicht.

## Arbeiten

```bash
cd server && npm test                                  # 61 Tests (node --test)
cd client && npm test                                  # 15 Tests (Eingabe-Tor, Teilbild/Meta)
cd server && node --test test/room.test.js             # eine Datei
cd server && node --test --test-name-pattern 'Biss'    # einzelne Tests
cd server && npm start                                 # Port 4263, DATA_DIR=./data
cd client && npm run dev                               # Port 5180, leitet /api + /ws weiter
./deploy.sh                                            # beide Suiten -> Build -> rsync -> Neustart -> Probe
```

**76 Tests**: Server 61 (`sim` 15 · `room` 19 · `db` 7 · `contract` 10 ·
`verbs` 10), Client 15 (`input` 7 · `meta` 8). Der Client testet mit einem
**handgerollten DOM-Ersatz** statt jsdom — das Repo bleibt abhängigkeitsfrei.

⚠️ **`contract.test.js` pinnt die Stellen, die in ZWEI Dateien stehen** —
Posen-Reihenfolge, Spaltenordnung des Schnappschusses, Code-Alphabet, und die
hart notierte `2.0` in `net.js` gegen `DIG.time`. Er liest beide Seiten aus dem
**Quelltext** aus; die erste Fassung verglich net.js nur gegen eine von Hand
getippte Liste und blieb bei einer in room.js eingeschobenen Spalte **grün** —
aufgefallen ist das erst durch die Mutationsprobe. Zweite Lehre aus derselben
Runde: eine `sed`-Mutation, die Definition *und* Verwendung umbenennt, ist ein
No-op und beweist gar nichts; Mutationen müssen **Werte** ändern. Browser-Prüfungen
laufen von Hand: `window.__br` gibt Zugriff auf `net`, `renderer` und `input` —
darüber wurden Drift, Kamera, Ereignisse und das Eingabe-Tor gemessen.

Grafik neu erzeugen (nur bei Änderungen in `artwork/`, braucht Pillow + ImageMagick):

```bash
python3 tools/cut_sprites.py && python3 tools/cut_props.py && python3 tools/pack_atlas.py
python3 tools/make_og.py       # Teilbild client/public/og.png (1200x630)
```

**Teilbild.** `make_og.py` malt den Boden mit demselben Verfahren und Startwert
wie `render.js` (`_makeGround`, Grundfarbe `#4a7a44`, Seed 1337) und schneidet
Hund und Knochen aus dem echten Atlas — das Bild sieht deshalb aus wie das
Spiel. Drei Dinge kosteten dabei Zeit:

* **Kontrast auf dem GRUND messen, nicht im fertigen Bild.** Der erste Prüflauf
  meldete durchweg 1,0:1, weil der hellste Punkt im Textkasten der Titel selbst
  war. Gemessen wird jetzt vor dem Satz, gegen den hellsten Bildpunkt im Kasten.
* **Schnitte über den Namen wählen, nicht über den Index.** Geratene `.ttc`-
  Indizes trafen „Regular"; „Heavy" liegt in derselben Datei auf 8.
* **Was hell ist, nachschlagen statt raten.** Zwei Fehlschläge waren der Knochen
  im Maul und der Kopf des Hundes unter dem Titel — beide erst durch Ausgeben
  der Koordinate des hellsten Punkts gefunden.

Die Meta-Angaben sind in `client/test/meta.test.mjs` gepinnt: `og:image`
**absolut** (Scraper lösen relative Pfade nicht auf), die angegebene Bildgröße
gegen den echten PNG-Kopf, `summary_large_image`, Bildbeschreibungen, gültiges
JSON-LD und dass im Kopf kein alter Hostname mehr steht.

**Ausrollen** (Details in `DEPLOY.md`): `deploy.sh` spiegelt `server/` **ohne**
`test/` und `public/`, legt den Client-Build nach `server/public/` und `shared/`
**als Geschwister von `server/`** ab — die Importe heißen `../shared/sim.js`,
diese Anordnung ist Teil des Vertrags. Danach `npm install --omit=dev`
(better-sqlite3 wird nativ gebaut), Neustart, `/api/health`-Probe.

**Neue Tests einmal mutieren.** Ein Test, den man nicht hat scheitern sehen, ist
keine Zusicherung — beim Bestenlisten-Fehler war genau das der Nachweis.
