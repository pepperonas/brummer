#!/usr/bin/env python3
"""Schritt 2: ausgewaehlte Frames -> ein Atlas (PNG + Phaser-3-JSON-Hash).

Die Blaetter sind erstaunlich massgleich (Koerperlaenge 532-609 px ueber alle
Blaetter), deshalb genuegt EINE Skala fuer alle Hundeposen. Gesichter und
Knochen bekommen eigene Skalen, weil sie in anderer Groesse gebraucht werden.

Drehpunkt ist ueberall (0.5, 1.0) -- Mitte/Unterkante. Fuer Posen, bei denen
der Hund in der Luft ist (Galopp, Hechtsprung), traegt der Katalog ein dy,
das die Pose auf die Bodenlinie zurueckholt.
"""
import json, os, shutil, subprocess
from PIL import Image

HERE = os.path.dirname(__file__)
SRC  = os.path.join(HERE, "..", "build", "frames")
OUT  = os.path.join(HERE, "..", "client", "public", "assets")

DOG, FACE, BONE = 0.50, 0.22, 0.80
# Front- und Rueckansichten kommen aus einem eigenen Blatt mit GROESSEREN
# Zellen (600x597 statt 688x384), die Rohbilder sind deshalb rund 500 px hoch
# statt 307. Eigene Skala, damit der Hund in allen Ansichten gleich hoch steht
# -- sonst wuechse er beim Richtungswechsel sichtbar.
# Gerechnet, nicht geraten: 307 * 0,50 / 500.
FB = 0.307

# (Quell-Key, Spielname, Skala, dy)  dy in ZIEL-Pixeln, positiv = nach unten
CATALOG = [
    # Gangart "aufrecht" (Ruecken 144-155 px ueber Boden) -- ein Zyklus
    ("s1_r2c0",  "walk0",      DOG,  0),
    ("v3_r2c0",  "walk1",      DOG,  0),
    ("v3_r2c1",  "walk2",      DOG,  0),
    ("s1_r1c0",  "walk3",      DOG,  0),
    ("v4_r2c0",  "walk4",      DOG,  0),
    # Gangart "geduckt" (124-134) -- eigener Zyklus, NICHT mit walk mischen
    ("v2_r0c0",  "prowl0",     DOG,  0),
    ("v4_r0c0",  "prowl1",     DOG,  0),
    ("v4_r1c0",  "prowl2",     DOG,  0),
    ("v2_r3c0",  "prowl3",     DOG,  0),
    # Galopp
    ("v2_r2c0",  "run0",       DOG,  0),
    ("v2_r2c1",  "run1",       DOG,  0),
    # Biss (Hechtsprung mit offenem Maul)
    ("v3_r3c3",  "bite0",      DOG,  0),
    ("v3_r3c2",  "bite1",      DOG,  0),
    # Einzelposen
    ("v4_r3c0",  "bark",       DOG,  0),
    ("v3_r1c0",  "sniff",      DOG,  0),
    ("s1_r3c0",  "sleep0",     DOG,  0),
    ("s1_r3c1",  "sleep1",     DOG,  0),
    ("v3_r0c0",  "sit",        DOG,  0),
    # HUD + Gegenstand
    # Front- und Rueckansichten (gezeichnetes Blatt lr-front-back.jpg).
    # Reihenfolge = Kontakt / Durchschwung / Kontakt gespiegelt / Durchschwung.
    ("fb_r0c0",  "front0",     FB, 0),
    ("fb_r0c1",  "front1",     FB, 0),
    ("fb_r0c2",  "front2",     FB, 0),
    ("fb_r0c3",  "front3",     FB, 0),
    ("fb_r1c0",  "back0",      FB, 0),
    ("fb_r1c1",  "back1",      FB, 0),
    ("fb_r1c2",  "back2",      FB, 0),
    ("fb_r1c3",  "back3",      FB, 0),
    ("fb_r2c0",  "frun0",      FB, 0),
    ("fb_r2c1",  "frun1",      FB, 0),
    # fb_r2c2 ist eine SEITENansicht statt einer Rueckansicht -- nicht genutzt,
    # Profile gibt es genug. Der Galopp nach hinten hat daher nur ein Bild.
    ("fb_r2c3",  "brun0",      FB, 0),
    ("emo_r0c0", "face_happy", FACE, 0),
    ("emo_r1c0", "face_angry", FACE, 0),
    ("prop_bone","bone",       BONE, 0),
]

PAD = 2
MAXW = 1024


def quantize(path, colors=220):
    """Farbtiefe senken. Die Sprites sind flaechig gezeichnet -- OHNE Dithering
    ist bei 220 Farben kein Unterschied zu sehen, die Datei aber ein Viertel
    so gross (709 -> 170 kB gemessen). MIT Dithering rauscht das schwarze Fell."""
    magick = shutil.which("magick") or shutil.which("convert")
    if not magick:
        print("  (ImageMagick fehlt -- Atlas bleibt unquantisiert)")
        return
    before = os.path.getsize(path)
    subprocess.run([magick, path, "-strip", "+dither", "-colors", str(colors),
                    "-define", "png:compression-level=9", path], check=True)
    after = os.path.getsize(path)
    print(f"  quantisiert: {before//1024} kB -> {after//1024} kB ({colors} Farben, ohne Dither)")


def main():
    os.makedirs(OUT, exist_ok=True)
    imgs = []
    for key, name, scale, dy in CATALOG:
        p = os.path.join(SRC, key + ".png")
        if not os.path.exists(p):
            raise SystemExit(f"FEHLT: {p}")
        im = Image.open(p).convert("RGBA")
        w = max(1, round(im.width * scale))
        h = max(1, round(im.height * scale))
        im = im.resize((w, h), Image.LANCZOS)
        imgs.append({"name": name, "img": im, "w": w, "h": h, "dy": dy, "src": key})

    # Regalpackung, nach Hoehe sortiert
    order = sorted(imgs, key=lambda d: -d["h"])
    x = y = shelf = 0
    for d in order:
        if x + d["w"] + PAD > MAXW:
            x = 0
            y += shelf + PAD
            shelf = 0
        d["x"], d["y"] = x, y
        x += d["w"] + PAD
        shelf = max(shelf, d["h"])
    total_h = y + shelf

    AH = (total_h + 3) // 4 * 4   # NPOT ist fuer Phaser 3 kein Problem
    atlas = Image.new("RGBA", (MAXW, AH), (0, 0, 0, 0))
    for d in order:
        atlas.paste(d["img"], (d["x"], d["y"]))
    atlas_path = os.path.join(OUT, "atlas.png")
    atlas.save(atlas_path)
    quantize(atlas_path)

    frames = {}
    pivots = {}
    for d in imgs:
        frames[d["name"]] = {
            "frame": {"x": d["x"], "y": d["y"], "w": d["w"], "h": d["h"]},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": d["w"], "h": d["h"]},
            "sourceSize": {"w": d["w"], "h": d["h"]},
        }
        pivots[d["name"]] = {"dy": d["dy"], "src": d["src"]}
    meta = {
        "image": "atlas.png", "format": "RGBA8888",
        "size": {"w": MAXW, "h": AH}, "scale": "1",
        "brummer": {"pivots": pivots},
    }
    with open(os.path.join(OUT, "atlas.json"), "w") as f:
        json.dump({"frames": frames, "meta": meta}, f, indent=1)

    fill = sum(d["w"] * d["h"] for d in imgs) / (MAXW * AH) * 100
    print(f"Atlas {MAXW}x{AH}, {len(imgs)} Frames, Fuellgrad {fill:.0f}%")
    for d in imgs:
        print(f"  {d['name']:<12} {d['w']:>4}x{d['h']:<4} @ {d['x']},{d['y']}   <- {d['src']}")


if __name__ == "__main__":
    main()
