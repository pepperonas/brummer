# Neue Sprites für Tyson erzeugen (Nano Banana 2)

> ✅ **Erledigt am 2026-08-20.** Das Blatt liegt als `artwork/lr-front-back.jpg`
> im Repo und ist verdrahtet. Diese Seite bleibt als Protokoll und als Vorlage
> für den nächsten Satz stehen; was beim echten Lauf herauskam, steht unten
> unter „Ergebnis".

Was fehlte: **Front- und Rückansicht**. Alle acht Original-Blätter zeigen Tyson
ausschließlich im Profil, deshalb steht beim Laufen nach oben und unten dasselbe
Seitenbild da. Alles Übrige (Gehen, Galopp, Beißen, Bellen, Schnüffeln, Graben,
Schlafen) ist vorhanden und braucht nichts.

---

## 1. Ja — Referenzbild hochladen

**Unbedingt.** Genau darin ist Nano Banana stark: Charakter-Konsistenz aus
Referenzen. Ohne Vorlage bekommst du einen generischen schwarzen Hund, dessen
Halsband, Kopfform und Strichstärke nicht zu den vorhandenen Sprites passen —
und der Bruch fällt im Spiel sofort auf, weil Profil und Front direkt
ineinander übergehen.

Lade diese **eine** Datei hoch:

    docs/referenz/tyson-referenz.png

Sie zeigt nebeneinander die Seitenansicht (der maßgebliche Stil), den frontalen
Kopf und den Körper von vorn. Mehr braucht es nicht.

> ⚠️ Der rechte Hund im Referenzbild ist **malerischer gezeichnet** als die
> Sprites. Der Prompt sagt deshalb ausdrücklich, dass der **linke** Hund den
> Stil vorgibt und der rechte nur die Anatomie von vorn.

---

## 2. Der Prompt — ein Bild, alle Sprites

Ein **4×3-Raster mit zwölf Posen** in einem Bild. Bildformat **4:3** (z. B.
2048×1536), damit die Zellen quadratisch werden: von vorn ist der Hund hochkant
(etwa 2:3), nicht breit wie im Profil (1,8:1).

```
Using the attached reference sheet: this is Tyson, a black Labrador-Rottweiler
mix. The LEFT dog defines the art style — flat cartoon vector, thick uniform
black outline, simple cel shading with soft grey highlights on black fur, brown
leather collar with a round silver tag. The RIGHT dog is only a reference for
front-view anatomy; do NOT copy its painterly rendering.

Create ONE sprite sheet image in 4:3 format, arranged as a strict 4-column ×
3-row grid of 12 equal square cells. Same dog in every cell, identical style,
identical proportions, identical size, identical camera height (eye level,
straight on). Only the pose changes.

Row 1 — walking TOWARD the viewer, seen from directly in FRONT, head level and
facing the camera, mouth slightly open:
  1. contact pose: left front paw forward and planted, right front paw lifted
  2. passing pose: front legs close together under the chest, body at its highest
  3. contact pose mirrored: right front paw forward, left lifted
  4. passing pose mirrored, weight on the other side

Row 2 — walking AWAY from the viewer, seen from directly BEHIND, tail up, back
of the head visible over the shoulders, no face:
  5. contact pose: left hind paw forward and planted, right hind paw lifted
  6. passing pose: hind legs close together
  7. contact pose mirrored
  8. passing pose mirrored

Row 3 — galloping:
  9.  from the FRONT, bounding toward the viewer, front legs reaching forward,
      body airborne
  10. from the FRONT, gathered mid-stride, legs tucked under the body
  11. from BEHIND, bounding away, hind legs extended back, body airborne
  12. from BEHIND, gathered mid-stride

Rules for every cell:
- full body, all four legs visible, nothing cropped or touching a cell edge
- every dog the same height on screen, all paws resting on the same imaginary
  ground line within its cell
- no cast shadow, no ground plane, no scenery
- plain flat background, solid colour #B7DAC1, identical in every cell
- no grid lines, no borders, no numbers, no text, no watermark
```

**Wichtig für Zeile 2:** „no face" steht bewusst da. Bildmodelle drehen den Kopf
gern zum Betrachter, weil Hunde meist so gezeichnet werden — beim Weglaufen ist
das grob falsch und fällt im Spiel sofort auf.

**Zwei Vorgaben sind weicher, als sie klingen** (nachgeprüft im Code):

* Die **Bildgröße** ist frei. `cut_sprites.py` rechnet die Zellgröße aus dem
  Bild (`Breite ÷ Spalten`), also passt jedes Format — nur das Raster muss
  stimmen und beim Eintragen richtig angegeben werden.
* Die **Hintergrundfarbe** wird erkannt (`bg_color()`), `#B7DAC1` ist nur eine
  Empfehlung. Entscheidend ist, dass sie **flach** ist und sich klar vom Hund
  abhebt — ein Verlauf bricht die Freistellung, ein Grauton zu nah am Fell
  ebenfalls.

### Wenn das Blatt nicht durchgehend konsistent wird

Zwölf zueinander passende Hunde in einer Generierung sind viel verlangt;
erfahrungsgemäß fallen ein bis drei Zellen aus dem Rahmen. Dann nicht alles neu
erzeugen, sondern **nur die schlechten Zellen einzeln** nachziehen (derselbe
Prompt, aber „Create ONE image showing the dog …" und die eine Pose) und mit
`tools/build_sheet.py` ein sauberes Blatt zusammensetzen — es erzwingt gleiche
Skala, gemeinsame **Bodenlinie** (der Drehpunkt der Pipeline sind die Pfoten;
liegen sie unterschiedlich hoch, zappelt der Hund beim Animieren) und Abstand
zum Zellrand. Aufruf: `python3 tools/build_sheet.py <ordner> <ziel.jpg>
--zeilen 3 --spalten 4`.

## 3. Was ein Bild erfüllen muss

Prüfe **vor** dem Weiterverarbeiten — jeder dieser Punkte bricht sonst die
Pipeline oder die Animation:

- [ ] **Einfarbiger Hintergrund**, kein Verlauf, kein Muster. Die Freistellung
      flutet von den Rändern; ein Verlauf lässt sie stehen oder überlaufen.
- [ ] **Kein gezeichneter Bodenschatten.** Die Pipeline entfernt helle,
      grün-dominante Schatten — verlässlicher ist, dass gar keiner da ist. Den
      Schatten macht die Engine.
- [ ] **Nichts angeschnitten**, ringsum Luft. Berührt der Hund den Bildrand,
      frisst sich die Flutfüllung in ihn hinein.
- [ ] **Gleiche Größenverhältnisse** über alle Bilder (Kopf zu Körper, Beinlänge).
      Nur die Pose ändert sich.
- [ ] **Gleiche Kamerahöhe.** Einmal von oben und einmal auf Augenhöhe gezeichnet
      passt später nicht zusammen.
- [ ] **Halsband braun mit rundem Anhänger** — die anderen Hunde im Spiel tragen
      türkise Seile, das ist ihr Erkennungszeichen.

---

## 4. Vom Bild ins Spiel

Das fertige Blatt kommt direkt in die Pipeline — `build_sheet.py` brauchst du
dafür **nicht**, das war der Weg für Einzelbilder.

```bash
# 1. Blatt ablegen
cp ~/tyson-front-back.png artwork/lr-front-back.jpg     # oder .png

# 2. In die SHEETS-Liste von tools/cut_sprites.py eintragen -- 4 Spalten, 3 Zeilen:
#       ("lr-front-back.jpg", 3, 4, "fb"),

# 3. Schneiden und packen
python3 tools/cut_sprites.py
python3 tools/pack_atlas.py     # Katalog um fb_r0c0 ... fb_r2c3 erweitern
```

Danach im Renderer eintragen — die Verdrahtung steht bereits:

```js
// client/src/render.js
const FRONT_SET = { walk: 'frontWalk', run: 'frontRun' };
```

Die Bildreihen `frontWalk` und `frontRun` existieren schon; nur die Namen darin
auf die neuen Atlas-Frames umstellen.

> **Vier Gehbilder genügen**, obwohl das Profil fünf hat. Die Schrittphase ist
> ein *Bruchteil des Zyklus*, kein Bildindex — bei vier Bildern deckt jedes 25 %
> ab statt 20 %, der Zyklus bleibt gleich lang und die Beine bleiben im Takt.
> ⚠️ Der Test `Jede frontale Reihe hat so viele Bilder wie ihr Profil-Gegenstück`
> pinnt heute Gleichheit, weil die *zusammengesetzten* Bilder 1:1 aus dem Profil
> stammen. Mit echten Zeichnungen ist er zu streng und gehört auf „Reihe ist
> nicht leer und alle Bilder liegen im Atlas" gelockert.

Für die **Rückansicht** ist im Renderer noch nichts vorgesehen: dort greift
heute bewusst die verkürzte Silhouette, weil ein Gesicht beim Weglaufen falsch
wäre. Sobald echte Rückenbilder da sind, kommt ein zweiter Satz analog zu
`FRONT_SET` dazu (Bedingung: `depth < -0.62`).

---

## 5. Was heute stattdessen passiert

Ohne neue Blätter bleibt es bei der **Tiefenachse**: je senkrechter die
Bewegung, desto schmaler die Silhouette (bis 42 %), dazu ±6 % Größe — weg wird
kleiner, her wird größer. Die Richtung ist damit ablesbar, ohne Bilder zu
behaupten, die es nicht gibt.

Ein erster Versuch, frontale Bilder aus vorhandenen Teilen **zusammenzusetzen**
(`tools/make_front.py`: Kopf des Profils abschneiden, Rumpf stauchen, frontalen
Kopf daraufsetzen), ist gebaut, getestet — und auf Nutzerentscheid abgeschaltet.
Der Generator bleibt im Repo, `FRONT_SET = {}` ist der einzige Schalter.

---

## 6. Ergebnis des Laufs (2026-08-20)

Das gelieferte Blatt war **2400×1792**, also 4:3 mit Zellen von 600×597 —
technisch sehr sauber:

| Prüfpunkt | Ergebnis |
|---|---|
| Raster | geht exakt auf |
| Hintergrund | `#B6D8BE`, Ecken einheitlich |
| Randabstand | mindestens 24 px, nichts angeschnitten |
| Bodenlinie | Zeile 0: **0 px** Streuung, Zeile 1: 2 px, Zeile 2: 6 px |
| Größen | 484–512 px, 5,5 % Streuung |
| Freistellung | keine Löcher, saubere Kanten |

**Elf von zwölf Zellen waren brauchbar.** Die Ausnahme: `r2c2` kam als
*Seitenansicht* statt als Rückansicht (528 px breit statt ~340) — deshalb hat
der Galopp nach hinten nur ein Bild. Beim nächsten Mal hilft es, für Zeile 3
ausdrücklich zu schreiben: *„all four cells show the dog from the FRONT or from
BEHIND — never from the side"*.

Die Anweisung **„no face"** für die Rückansichten hat gegriffen: alle vier
Zellen zeigen den Hund korrekt von hinten mit erhobener Rute.

**Was danach im Spiel zu tun war** (falls ein zweiter Satz kommt):

* eigene Atlas-Skala, weil die neuen Zellen größer sind als die alten
  (`FB = 0,307`, gerechnet als `307 × 0,50 ÷ 500`),
* Hysterese weiten (Austritt 0,42 → 0,34): im Gedränge schiebt die Trennung der
  Hunde den Läufer seitwärts, `depth` fiel dabei von 0,74 auf 0,37 und die
  Ansicht kippte bei jedem Rempler zurück,
* den getragenen Knochen an die Ansicht koppeln — von hinten gar nicht zeichnen,
  von vorn mittig unter die Schnauze statt seitlich.
