#!/usr/bin/env python3
"""
Pipeline-Schritt 1b: FRONTALE Laufbilder aus vorhandenen Teilen bauen.

Warum das noetig ist: alle fuenf Sprite-Blaetter zeigen den Hund ausschliesslich
im PROFIL. Laeuft er im Spiel nach oben oder unten, stand bisher trotzdem die
Seitenansicht da -- der Hund lief sichtbar quer, waehrend er sich senkrecht
bewegte. Front- und Rueckansichten gibt es in keinem Blatt.

Was es gibt: die frontalen KOEPFE des Emotionsblatts. Daraus laesst sich ein
frontales Laufbild zusammensetzen:

  1. vom Profil-Laufbild den rechten Teil (Kopf + Hals) abschneiden,
  2. den Rumpf waagerecht stauchen -- ein Hund, der auf dich zulaeuft, ist
     schmal; die gestauchten Flanken lesen sich als Brust,
  3. den frontalen Kopf daraufsetzen.

Die Beine kommen aus dem Profilzyklus und behalten dadurch ihren Takt: Frame
fuer Frame dieselbe Beinstellung wie seitlich, nur schmaler. Das ist der
klassische Umgang mit knappem Sprite-Bestand, kein Ersatz fuer gezeichnete
Frontal-Laufbilder -- aber es liest sich als Richtung, und das ist der Zweck.

⚠️ NUR fuer die Bewegung ZUM Betrachter. Von hinten waere ein frontales
Gesicht falsch herum; dort bleibt das gestauchte Profil (man sieht ohnehin
kein Gesicht).

    python3 tools/make_front.py        -> build/frames/front{0..4}.png
"""
import os
from PIL import Image

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "..", "build", "frames")

# Dieselben Quellen wie in pack_atlas.py -- so bleibt der Takt identisch mit
# dem Profilzyklus, und der Wechsel der Ansicht faellt nicht auf.
SAETZE = {
    "front":  ["s1_r2c0", "v3_r2c0", "v3_r2c1", "s1_r1c0", "v4_r2c0"],   # walk
    "frun":   ["v2_r2c0", "v2_r2c1"],                                     # run
    "fprowl": ["v2_r0c0", "v4_r0c0", "v4_r1c0", "v2_r3c0"],               # prowl
}
HEAD = "emo_r0c0"          # Tyson, froehlich, frontal

HEAD_CUT = 0.30            # rechter Anteil des Profils = Kopf+Hals, faellt weg
BODY_SQUASH = 0.58         # Rumpf waagerecht stauchen
HEAD_H = 0.60              # Kopfhoehe, relativ zur Rumpfhoehe
HEAD_SINK = 0.62           # wie tief der Kopf in die Schultern rutscht
HEAD_SHIFT = 0.02          # winziger Versatz zur Blickseite


def lade(key):
    p = os.path.join(SRC, key + ".png")
    if not os.path.exists(p):
        raise SystemExit(f"fehlt: {p}\nErst 'python3 tools/cut_sprites.py' laufen lassen.")
    return Image.open(p).convert("RGBA")


def beschneiden(im):
    """Auf sichtbaren Inhalt beschneiden -- sonst wandert der Drehpunkt."""
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def frontal(koerper, kopf):
    # 1. Kopf + Hals abschneiden. Der Hund blickt im Profil nach RECHTS.
    schnitt = int(koerper.width * (1 - HEAD_CUT))
    rumpf = beschneiden(koerper.crop((0, 0, schnitt, koerper.height)))

    # 2. stauchen
    bw = max(1, int(round(rumpf.width * BODY_SQUASH)))
    rumpf = rumpf.resize((bw, rumpf.height), Image.LANCZOS)

    # 3. Kopf skalieren
    kh = max(1, int(round(koerper.height * HEAD_H)))
    kw = max(1, int(round(kopf.width * kh / kopf.height)))
    k = kopf.resize((kw, kh), Image.LANCZOS)

    # Der Kopf sitzt IN den Schultern, nicht darueber -- sonst schwebt er.
    ueberstand = int(round(kh * (1 - HEAD_SINK)))
    breite = max(bw, kw) + 4
    hoehe = rumpf.height + ueberstand
    out = Image.new("RGBA", (breite, hoehe), (0, 0, 0, 0))

    # Rumpf steht auf der Unterkante: der Drehpunkt der Pipeline ist die
    # Bodenlinie, die Pfoten muessen also unten bleiben.
    out.alpha_composite(rumpf, ((breite - bw) // 2, ueberstand))
    kx = (breite - kw) // 2 + int(round(breite * HEAD_SHIFT))
    out.alpha_composite(k, (max(0, min(breite - kw, kx)), 0))
    return beschneiden(out)


def main():
    kopf = lade(HEAD)
    gesamt = 0
    for name, quellen in SAETZE.items():
        for i, key in enumerate(quellen):
            bild = frontal(lade(key), kopf)
            bild.save(os.path.join(SRC, f"{name}{i}.png"))
            print(f"  {name}{i}  {bild.width}x{bild.height}  (aus {key})")
            gesamt += 1
    print(f"-> {gesamt} frontale Bilder in build/frames/")


if __name__ == "__main__":
    main()
