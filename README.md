# Brummer

Ein Online-Arenaspiel für 2–8 Spieler, gebaut aus einer Sammlung Sprite-Blätter
von **Tyson** — einem schwarzen Labrador-Rottweiler-Mischling.

**Spielen: https://brummer.celox.io**

Knochen holen, im Maul zur eigenen Hütte tragen, abliefern. Wer gebissen wird,
verliert ihn auf der Stelle. Drei Minuten pro Runde, die meisten Knochen
gewinnen.

---

## Warum das Spiel so aussieht, wie es aussieht

Die Zeichnungen kamen zuerst, das Spiel danach. Sie enthalten keine zufällige
Posensammlung, sondern eine fast vollständige Verb-Liste — und jede Pose ist
zu einer Mechanik geworden:

| Gezeichnete Pose | Mechanik im Spiel |
|---|---|
| Traben, Gehen | Grundbewegung in acht Richtungen |
| Rennen mit Staubwolke | Sprint mit Ausdauerleiste |
| Hechtsprung mit offenem Maul | **Biss** — Gegner verliert Knochen, 1,4 s betäubt |
| Bellen, Knurren | Druckwelle: schiebt weg, unterbricht Graben |
| Schnüffeln mit Duftspur | **Fährte** — zeigt vergrabene Depots im Umkreis |
| Nase am Boden, Truhe | **Buddeln** — Depot mit 3 Knochen, 2 s wehrlos |
| Schlafen mit Z-Z-Z | Betäubt am Boden |
| Kopfportraits (fröhlich/knurrend) | HUD und Meldungen |

Zwei Entscheidungen tragen den Rest:

**Perspektive.** Alle Laufsprites sind reines Profil. Ein Spiel von oben bräuchte
Draufsichten, ein Plattformer bräuchte Level-Tilesets — beides gibt es nicht.
Also die **2,5-D-Ebene der Beat-'em-ups**: Bewegung in acht Richtungen auf einem
Boden, Sprites bleiben seitlich, Tiefensortierung nach Y. Sie kommt mit einer
Bodentextur, einem Zaun und vier Hütten aus — alles ohne Charakterkunst
herstellbar.

**Ein Knochen im Maul.** Das erzwingt den Rückweg durch die Arena und macht
jeden Träger zum lohnenden Ziel. Ohne diese Regel sammelt jeder in seiner Ecke
und niemand beißt.

## Aufbau

```
artwork/     die acht Original-Blätter (JPEG, farbiger Grund)
tools/       Asset-Pipeline: schneiden, freistellen, Atlas packen
shared/      sim.js -- die Simulation, die Server UND Client rechnen
server/      autoritativer Spielserver (Node + ws + SQLite)
client/      Canvas2D-Client (Vite, kein Framework)
```

### Die Simulation liegt in `shared/`

`shared/sim.js` läuft **wortgleich** im Server (autoritativ) und im Client
(Vorhersage). Der Client wendet jede Eingabe sofort lokal an und behält sie;
kommt ein Schnappschuss, wird die eigene Figur auf den Serverzustand gesetzt und
alle seither ungequittierten Eingaben werden erneut abgespielt. Gemessene
Abweichung im Betrieb: **0,3 Welteinheiten** bei einem 68 Einheiten breiten Hund.

Fremde Figuren werden dagegen interpoliert und bewusst 90 ms in der
Vergangenheit gezeichnet — sonst müsste man bei jedem verlorenen Paket raten.

Treffer werden **ausschließlich serverseitig** geprüft. Der Client schickt nur
Eingaben, nie Positionen; Richtungswerte und Tastenmaske werden geklemmt.

## Entwickeln

```bash
# Server (Port 4263)
cd server && npm install && npm start

# Client mit Hot-Reload (Port 5180, leitet /api und /ws an 4263 weiter)
cd client && npm install && npm run dev

# Tests
cd server && npm test      # 41 Tests: Simulation, Spielregeln, Datenhaltung
```

### Grafik neu erzeugen

Nur nötig, wenn sich in `artwork/` etwas ändert:

```bash
python3 tools/cut_sprites.py    # 4x4-Raster schneiden, freistellen, beschneiden
python3 tools/cut_props.py      # lose Gegenstände (Knochen)
python3 tools/pack_atlas.py     # Atlas + Phaser-JSON nach client/public/assets/

# Ergebnis durchblättern (Zwiebelhaut zeigt Ausrichtungsfehler)
python3 -m http.server 8123 && open http://localhost:8123/tools/sprite-lab.html
```

Braucht Python mit Pillow und ImageMagick.

## Was beim Bauen wichtig war

**Die Blätter sind Posen, keine Animationszyklen.** Die vier Bilder einer Reihe
sind Varianten, keine Phasen einer Laufbewegung. Gemessen an der Rückenhöhe über
der Bodenlinie zerfallen sie in zwei saubere Gangarten: „aufrecht" (144–155 px)
und „geduckt" (124–134 px). Mischt man sie, pumpt der Hund beim Laufen mit dem
Kopf. Getrennt ergeben sie einen **5-Frame-Laufzyklus mit 3 px Streuung** und
einen eigenen Schleichgang, der jetzt das Tragen darstellt. Alles Weitere —
Wippen, Stauchen, Staub — ist prozedural.

**Freistellen ist das Nadelöhr, nicht das Spiel.** JPEG auf einfarbigem Grund,
kein Alphakanal. Die Flutfüllung läuft von den Rändern (nicht global — das risse
Löcher in alles im Hund, was zufällig ähnlich hell ist), dann Despill und weiche
Kante. Die gezeichneten Bodenschatten überleben das, weil sie die Füllung nicht
erreicht: sie sind **hell und grün-dominant**, während das Fell neutral ist —
diese Kombination trifft ausschließlich Schatten.

**Der Atlas ist ohne Dithering quantisiert.** Bei 220 Farben ist kein Unterschied
zu sehen, die Datei aber ein Viertel so groß (709 → 170 kB). *Mit* Dithering
rauscht das schwarze Fell sichtbar.

**Kein Spiel-Framework.** Phaser wiegt ~1,3 MB, gebraucht würde davon der
Atlas-Loader. Tiefensortierung, 2,5-D-Projektion und Animation sind ohnehin
selbst geschrieben. Das gesamte Spiel wiegt **23 kB** (9 kB gzip) plus 170 kB
Grafik.

## Grafik

Alle Zeichnungen zeigen Tyson und gehören Martin Pfeffer. Code unter MIT.
