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

## Animation

**Der Schritt haengt an der STRECKE, nicht an einer Bildrate.** `dogVisual`
zaehlt die Phase mit `dist / STRIDE[anim]` hoch — daraus ergibt sich der Takt
von selbst (Zyklen/s = Tempo / Schrittlaenge), und die Beine bleiben bei jedem
Tempo und jeder Geraete-Bildrate am Boden. Eine feste Bildrate loest sie davon
(„foot sliding"), sobald das Tempo nicht exakt zum Takt passt.

⚠️ **Der alte Sprint war nachweislich falsch herum:** 2 Bilder à 13 fps ergaben
6,5 Galoppzyklen/s und damit **52 Welteinheiten Schrittlaenge — KUERZER als der
Geh-Schritt (119)** bei fast doppeltem Tempo, also 0,77 Koerperlaengen je
Sprung. Ein echter Hund macht 2–2,5 bei 2,5–3,5 Zyklen/s. Das war die Ursache
des Flimmerns. Jetzt `STRIDE.run = 120` → live gemessen 3,31 Zyklen/s bei
Tempo 387. In `client/test/anim.test.mjs` gepinnt, inklusive der Regel, dass
der Sprint-Schritt laenger sein muss als der Geh-Schritt.

**Galopp:** EIN Flugbogen je Zyklus, gelegt auf das gestreckte Bild (vorher hob
`|sin(ph·π)|` zweimal je Zyklus = Huepfen statt Galopp). Hoehe, Streckung und
Vorlage skalieren mit dem Tempo. Der Schatten schrumpft und verblasst mit der
Flughoehe — erst das macht den Sprung lesbar.

**Biss:** eigene Uhr, an der Flanke gestartet — der Schnappschuss traegt keinen
Biss-Fortschritt (waere ein Byte je Spieler und Takt), die Dauer ist aber eine
Konstante. Drei Abschnitte statt einer Bildschleife: **Anticipation** (11
Einheiten zurueckziehen, ducken), **Zuschnappen** (ease-out nach vorn, Flugbogen,
gestreckt) und **Nachschwingen** (einfedern, ausschwingen). `bite0` ist der
Anlauf, `bite1` der Schlag — vorher liefen beide als 14-fps-Schleife. Live
gemessen: −9,5 zurueck / +15 vor / 16,7 hoch / squash 0,834.

⚠️ **Die Drehung steht in `drawSprite` VOR dem Spiegeln**, wirkt also im
ungespiegelten System: jeder Lehnwinkel muss mit `facing` multipliziert werden,
sonst lehnt der linkslaufende Hund nach hinten. Gepinnt.

⚠️ **Die Glaettung ist ein Tiefpass und daempft den Flugbogen mit.** Bei 2,94
Zyklen/s liess Rate 22 nur 77 % der Sprunghoehe uebrig und schob den Bogen
38 ms hinter den Bildwechsel. Rate 55 haelt 95 % und 18 ms (unter einem Bild bei
60 Hz) und glaettet Zustandswechsel weiterhin ueber ~3 Bilder.

**Die Drehung laeuft stufenlos.** `facing` kippt im Modell hart von +1 auf −1;
der Renderer fuehrt daneben ein eigenes `face` (−1…+1), das per Feder folgt
(`TURN_RATE` 30, Schwenk gut 100 ms) und dabei durch die Kante geht — das liest
sich als Pirouette statt als Spiegelfehler. ⚠️ `TURN_MIN` (0,16) verhindert,
dass der Hund fuer ein Bild voellig verschwindet, und der getragene Knochen
haengt an `v.face`, nicht an `p.facing` — sonst steht er neben dem Hund,
waehrend der sich dreht. `drawSprite` nimmt dafuer `face` (stufenlos); `flip`
bleibt fuer alle anderen Aufrufer.

**Beschleunigung traegt die Koerpersprache.** Wer anzieht, legt sich nach vorn,
wer bremst, faellt zurueck (`zug` aus der geglaetteten Tempoableitung). Ohne das
ist das Tempo aus dem Nichts da.

**Die Interaktionen waren Standbilder.** Bellen stand auf EINER festen Zahl fuer
0,45 s, ein Treffer auf `rot = 0.05`, Graben auf einem symmetrischen Sinus.
Jetzt: **Bellen** = normierter Stoss-Impuls (Vorstoss + Stauchung + Kopf hoch,
klingt ab), **Treffer** = Rueckwurf vom Angreifer weg mit Kippen und Aufschlag,
danach Ablegen, **Graben** = asymmetrischer Schlag (35 % hin, 65 % zurueck —
ein Sinus liest sich als Zittern, nicht als Arbeit) mit Erde auf jeden
Schuerfer. **Tragen** sackt unter die neutrale Linie statt nur weniger zu
schwingen.

⚠️ **Abklingkurven deckeln ihren eigenen Faktor.** `sin(k·π·3,2)·e^(−7k)`
erreicht als Gipfel nur **0,42** — aus „7 Einheiten Stoss" wurden gemessene 2,4,
also 3,5 % der Koerperlaenge und praktisch unsichtbar. Solche Huellkurven
gehoeren auf Gipfel 1 normiert (hier Faktor 2,38). Der Test misst deshalb in
**Koerperlaengen**, nicht in nackten Einheiten.

**Staub faellt auf den Fusstritt**, nicht nach Wuerfel: der alte Wurf in
`main.js` (`Math.random() < 0.35` je Bild) haing an der Bildrate — bei 144 Hz
das 2,4-fache eines 60-Hz-Geraets.

**Eingabe-Raste (`TAP_BITS` in `input.js`).** Die Eingabe wird nur im Servertakt
abgetastet (30 Hz). **Live gemessen: ein Druck unter 20 ms loeste keinen Biss
aus** — er fiel zwischen zwei Abtastungen durch, der Spieler drueckte und nichts
geschah. Jeder Druck wird jetzt bis zur naechsten Abtastung gerastet (danach
gemessen: schon 2 ms reichen). ⚠️ Sprint ist bewusst NICHT dabei (Halten, kein
Antippen), und die Raste sitzt HINTER dem Textfeld-Tor — sonst beisst jeder
Leerschlag beim Namentippen.

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
cd client && npm test                                  # 47 Tests (Eingabe, Animation, Meta)
cd server && node --test test/room.test.js             # eine Datei
cd server && node --test --test-name-pattern 'Biss'    # einzelne Tests
cd server && npm start                                 # Port 4263, DATA_DIR=./data
cd client && npm run dev                               # Port 5180, leitet /api + /ws weiter
./deploy.sh                                            # beide Suiten -> Build -> rsync -> Neustart -> Probe
```

**108 Tests**: Server 61 (`sim` 15 · `room` 19 · `db` 7 · `contract` 10 ·
`verbs` 10), Client 47 (`input` 13 · `anim` 26 · `meta` 8). Der Client testet mit einem
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
