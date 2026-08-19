# Neue Sprites für Tyson erzeugen (Nano Banana 2)

Was fehlt: **Front- und Rückansicht**. Alle acht Original-Blätter zeigen Tyson
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

## 2. Der Prompt

Eine Pose pro Bild erzeugen — nicht das ganze Raster. Sechzehn zueinander
konsistente Zellen in einer Generierung schafft kein Bildmodell zuverlässig;
einzeln wird jede Pose besser, und `tools/build_sheet.py` setzt das Blatt
danach zusammen.

Englisch, weil Bildmodelle darauf verlässlicher reagieren:

```
Using the attached reference sheet: this is Tyson, a black Labrador-Rottweiler
mix. The LEFT dog defines the art style — flat cartoon vector, thick uniform
black outline, simple cel shading with soft grey highlights on black fur, brown
leather collar with a round silver tag. The RIGHT dog is only a reference for
front-view anatomy; do NOT copy its painterly rendering.

Draw the SAME dog in the SAME style, seen from directly in FRONT, walking
toward the viewer — contact pose, left front paw forward and planted, right
front paw lifted mid-stride, head level and facing the camera, mouth slightly
open, tail visible behind the body.

Requirements:
- full body, all four legs visible, nothing cropped
- centred, standing on flat ground, no cast shadow, no ground plane drawn
- plain flat background, solid colour #B7DAC1, nothing else in the image
- no text, no borders, no frame, no watermark
- same line weight and same proportions as the left reference dog
- square image, dog fills about 70 % of the height
```

**Die drei Stellen, die du je Bild änderst** — alles Übrige bleibt wörtlich
stehen, das hält den Stil zusammen:

| # | Ansicht | Pose (statt des kursiven Absatzes oben) |
|---|---|---|
| 1 | vorn | contact pose, left front paw forward and planted, right front paw lifted |
| 2 | vorn | passing pose, both front legs close together under the chest, body at its highest |
| 3 | vorn | contact pose mirrored — right front paw forward, left lifted |
| 4 | vorn | passing pose mirrored, weight on the other side |
| 5 | hinten | *seen from directly BEHIND, walking away* — contact pose, tail up, head slightly visible over the shoulders |
| 6 | hinten | passing pose, both hind legs together |
| 7 | hinten | contact pose mirrored |
| 8 | hinten | passing pose mirrored |

Optional, wenn das Gehen überzeugt — Galopp (je zwei Bilder):

| # | Ansicht | Pose |
|---|---|---|
| 9 | vorn | *bounding toward the viewer*, front legs extended forward, hind legs pushing off, body airborne |
| 10 | vorn | gathered mid-stride, legs tucked under the body |
| 11 | hinten | *bounding away*, hind legs extended back, body airborne |
| 12 | hinten | gathered mid-stride |

---

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

```bash
# 1. Einzelbilder in einen Ordner legen, alphabetisch = Lesereihenfolge
#    (01-front-contact.png, 02-front-passing.png, ...)
python3 tools/build_sheet.py ~/tyson-neu artwork/lr-front-back.jpg --zeilen 2 --spalten 4

# 2. Blatt in die SHEETS-Liste von tools/cut_sprites.py eintragen:
#       ("lr-front-back.jpg", 2, 4, "fb"),

# 3. Schneiden und packen
python3 tools/cut_sprites.py
python3 tools/pack_atlas.py     # Katalog um fb_r0c0 ... erweitern
```

`build_sheet.py` nimmt dir das ab, was die Pipeline sonst nicht verzeiht:
gemeinsame Skala, gemeinsame **Bodenlinie** (der Drehpunkt sind die Pfoten —
liegen sie unterschiedlich hoch, zappelt der Hund beim Animieren) und
Sicherheitsabstand zum Zellrand.

Danach im Renderer eintragen — die Verdrahtung steht bereits:

```js
// client/src/render.js
const FRONT_SET = { walk: 'frontWalk', run: 'frontRun', prowl: 'frontProwl' };
```

Die Bildreihen `frontWalk` / `frontRun` / `frontProwl` existieren schon; nur die
Namen darin auf die neuen Atlas-Frames umstellen. **Jede Reihe muss so viele
Bilder haben wie ihr Profil-Gegenstück** (Gehen 5, Galopp 2, Tragen 4), sonst
springen beim Ansichtswechsel die Beine — ein Test pinnt das.

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
