#!/usr/bin/env python3
"""
Einzelbilder -> Sprite-Blatt im Format der Original-Blaetter.

Warum: ein Bildmodell erzeugt 16 zueinander konsistente Zellen in EINER
Generierung nicht zuverlaessig. Praktikabel ist, jede Pose einzeln (oder zu
zweit) zu erzeugen und das Raster hier zusammenzusetzen. Das Ergebnis geht
danach unveraendert durch `cut_sprites.py` -> `pack_atlas.py`.

Was das Skript abnimmt -- und was die Pipeline sonst nicht verzeiht:
  * einheitliche Zellgroesse und Hintergrundfarbe,
  * gleiche Skala ueber alle Zellen (EIN Massstab fuer alle Hundeposen),
  * gemeinsame BODENLINIE -- der Drehpunkt der Pipeline sind die Pfoten;
    liegen sie unterschiedlich hoch, zappelt der Hund beim Animieren,
  * Sicherheitsabstand zum Zellrand (die Freistellung flutet von den Raendern;
    beruehrt der Hund den Rand, frisst sie sich in ihn hinein).

Aufruf:
    python3 tools/build_sheet.py bilder/ artwork/neu-front.jpg --spalten 4

`bilder/` enthaelt PNG oder JPG, alphabetisch = Lesereihenfolge (zeilenweise).
Freigestellte PNG mit Alpha sind ideal; Bilder mit flachem Hintergrund werden
per Randflutung freigestellt.
"""
import argparse
import os
import sys
from collections import deque

from PIL import Image

ZELLE_B, ZELLE_H = 688, 384
HINTERGRUND = (183, 219, 193)      # #B7DAC1 -- wie die Original-Blaetter
RAND = 26                          # Mindestabstand zum Zellrand
BODEN = 8                          # Abstand der Pfoten zur Zellunterkante
TOL = 34                           # Farbtoleranz der Randflutung


def freistellen(im, tol=TOL):
    """Flutfuellung von den Raendern. NICHT global ersetzen -- das risse Loecher
    in alles im Hund, was zufaellig aehnlich hell ist."""
    im = im.convert("RGBA")
    if im.getchannel("A").getextrema()[0] < 255:
        return im                                    # hat schon Alpha
    w, h = im.size
    px = im.load()
    grund = px[0, 0][:3]
    gesehen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or gesehen[y * w + x]:
            continue
        r, g, b, _ = px[x, y]
        if abs(r - grund[0]) + abs(g - grund[1]) + abs(b - grund[2]) > tol * 3:
            continue
        gesehen[y * w + x] = 1
        px[x, y] = (r, g, b, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def beschneiden(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def einpassen(im, hoehe_ziel):
    """Auf eine gemeinsame Hoehe bringen -- EIN Massstab fuer alle Posen."""
    f = hoehe_ziel / im.height
    b = max(1, round(im.width * f))
    h = max(1, round(im.height * f))
    return im.resize((b, h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("quelle", help="Ordner mit den Einzelbildern")
    ap.add_argument("ziel", help="Zieldatei (.jpg oder .png)")
    ap.add_argument("--spalten", type=int, default=4)
    ap.add_argument("--zeilen", type=int, default=4)
    ap.add_argument("--hoehe", type=int, default=0,
                    help="Zielhoehe des Hundes in px (0 = automatisch aus dem hoechsten Bild)")
    a = ap.parse_args()

    dateien = sorted(f for f in os.listdir(a.quelle)
                     if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
    if not dateien:
        sys.exit(f"keine Bilder in {a.quelle}")
    if len(dateien) > a.zeilen * a.spalten:
        sys.exit(f"{len(dateien)} Bilder passen nicht in {a.zeilen}x{a.spalten} Zellen")

    bilder = [beschneiden(freistellen(Image.open(os.path.join(a.quelle, f)))) for f in dateien]

    # Gemeinsame Skala: die groesste Pose bestimmt sie, damit nichts anstoesst.
    frei_h = ZELLE_H - RAND - BODEN
    frei_b = ZELLE_B - 2 * RAND
    hoehe = a.hoehe or min(frei_h, int(frei_h))
    skala = min(hoehe / max(i.height for i in bilder),
                frei_b / max(i.width for i in bilder))
    bilder = [einpassen(i, max(1, round(i.height * skala))) for i in bilder]

    blatt = Image.new("RGB", (ZELLE_B * a.spalten, ZELLE_H * a.zeilen), HINTERGRUND)
    for n, (name, im) in enumerate(zip(dateien, bilder)):
        r, c = divmod(n, a.spalten)
        # waagerecht mittig, Pfoten auf der gemeinsamen Bodenlinie
        x = c * ZELLE_B + (ZELLE_B - im.width) // 2
        y = (r + 1) * ZELLE_H - BODEN - im.height
        blatt.paste(im, (x, y), im)
        print(f"  r{r}c{c}  {name}  ->  {im.width}x{im.height}")

    kwargs = {"quality": 95, "subsampling": 0} if a.ziel.lower().endswith((".jpg", ".jpeg")) else {}
    blatt.save(a.ziel, **kwargs)
    print(f"-> {a.ziel}  {blatt.width}x{blatt.height}  ({len(bilder)} Zellen)")
    print("   Weiter: cut_sprites.py (Blatt in SHEETS eintragen) -> pack_atlas.py")


if __name__ == "__main__":
    main()
