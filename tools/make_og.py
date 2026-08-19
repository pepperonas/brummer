#!/usr/bin/env python3
"""
Teilbild (Open Graph, 1200x630) aus den ECHTEN Spiel-Assets erzeugen.

Kein Fremdmaterial: der Boden wird mit demselben Verfahren und derselben
Grundfarbe gemalt wie in `client/src/render.js` (_makeGround), der Hund und der
Knochen kommen aus `client/public/assets/atlas.png`. Das Bild sieht damit aus
wie das Spiel und nicht wie ein Werbebanner daneben.

Der Kontrast wird am Ende GEMESSEN, nicht geschaetzt -- gegen den HELLSTEN
Bildpunkt hinter der jeweiligen Schrift, so wie es die Hausregel verlangt.

    python3 tools/make_og.py
    -> client/public/og.png
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
ATLAS_PNG = ROOT / "client/public/assets/atlas.png"
ATLAS_JSON = ROOT / "client/public/assets/atlas.json"
OUT = ROOT / "client/public/og.png"

W, H = 1200, 630

# Palette aus client/src/style.css :root -- eine Quelle, keine zweite Wahrheit.
GROUND = (0x13, 0x18, 0x15)
TEXT = (0xE8, 0xEE, 0xE9)
DIM = (0xA7, 0xB2, 0xA9)
MINT = (0x8F, 0xCB, 0xA4)
BONE = (0xE8, 0xDC, 0xC0)
GRASS = (0x4A, 0x7A, 0x44)          # identisch zu _makeGround()

# Schnitte werden ueber den NAMEN gewaehlt, nicht ueber den Index: mein erster
# Versuch riet die Indizes (7,5,0) und traf damit "Regular" -- der Titel stand
# duenn da, obwohl "Heavy" (Index 8) in derselben Datei liegt.
FONT_FILES = [
    "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]
WEIGHTS = {
    "heavy":  ("Heavy", "Black", "Bold"),
    "bold":   ("Bold", "Demi Bold", "Heavy"),
    "medium": ("Medium", "Demi Bold", "Regular"),
}


def font(size: int, weight: str = "heavy") -> ImageFont.FreeTypeFont:
    """Erste Schrift, die den gewuenschten Schnitt hergibt. Ohne Treffer bricht
    das Skript ab -- ein stiller Bitmap-Ersatz saehe im Teilbild erbaermlich aus."""
    for want in WEIGHTS[weight]:
        for path in FONT_FILES:
            for idx in range(20):
                try:
                    f = ImageFont.truetype(path, size, index=idx)
                except Exception:
                    break
                if f.getname()[1] == want:
                    return f
    sys.exit(f"kein Schnitt '{weight}' gefunden -- FONT_FILES anpassen")


# --- Boden ------------------------------------------------------------------
def grass_tile(size: int = 256) -> Image.Image:
    """Portierung von _makeGround() aus render.js, inklusive Startwert 1337,
    damit der Rasen derselbe ist wie im Spiel."""
    img = Image.new("RGB", (size, size), GRASS)
    d = ImageDraw.Draw(img, "RGBA")

    seed = 1337

    def rnd() -> float:
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x7FFFFFFF

    def hsl(h: float, s: float, ll: float) -> tuple[int, int, int]:
        c = (1 - abs(2 * ll - 1)) * s
        x = c * (1 - abs((h / 60) % 2 - 1))
        m = ll - c / 2
        r, g, b = {0: (c, x, 0), 1: (x, c, 0), 2: (0, c, x),
                   3: (0, x, c), 4: (x, 0, c), 5: (c, 0, x)}[int(h // 60) % 6]
        return (round((r + m) * 255), round((g + m) * 255), round((b + m) * 255))

    for _ in range(1400):                       # Grasbueschel
        x, y = rnd() * size, rnd() * size
        h = 3 + rnd() * 6
        l = 38 + rnd() * 20
        col = hsl(95 + rnd() * 22, 0.30, l / 100)
        d.line([(x, y), (x + (rnd() - .5) * 3, y - h)], fill=col, width=1 + int(rnd() * 2))

    for _ in range(90):                         # weiche Flecken
        x, y = rnd() * size, rnd() * size
        r = 6 + rnd() * 22
        col = hsl(100 + rnd() * 18, 0.26, (30 if rnd() > .5 else 44) / 100)
        d.ellipse([x - r, y - r * .6, x + r, y + r * .6], fill=col + (41,))
    return img


def ground_layer() -> Image.Image:
    tile = grass_tile()
    img = Image.new("RGB", (W, H))
    for y in range(0, H, tile.height):
        for x in range(0, W, tile.width):
            img.paste(tile, (x, y))
    return img


# --- Atlas ------------------------------------------------------------------
class Atlas:
    def __init__(self) -> None:
        self.img = Image.open(ATLAS_PNG).convert("RGBA")
        self.frames = json.loads(ATLAS_JSON.read_text())["frames"]

    def cut(self, name: str) -> Image.Image:
        f = self.frames[name]["frame"]
        return self.img.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))

    def scaled(self, name: str, height: int, flip: bool = False) -> Image.Image:
        s = self.cut(name)
        w = round(s.width * height / s.height)
        s = s.resize((w, height), Image.LANCZOS)
        return s.transpose(Image.FLIP_LEFT_RIGHT) if flip else s


def shadow(img: Image.Image, cx: int, cy: int, rx: int, ry: int, alpha: int) -> None:
    """Weicher Bodenschatten. Eigene Ebene + Weichzeichner -- eine harte Ellipse
    saehe wie ein Aufkleber aus."""
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(0, 0, 0, alpha))
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(18)))


# --- Kontrast (gemessen, nicht geschaetzt) ----------------------------------
def rel_lum(c: tuple[int, int, int]) -> float:
    def ch(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in c[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    a, b = rel_lum(fg), rel_lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def worst_contrast(img: Image.Image, fg, box) -> float:
    """Schlechtester Fall: die Schrift gegen den HELLSTEN Bildpunkt in ihrem
    Kasten. Ein Mittelwert wuerde eine helle Grasspitze unterschlagen.

    ⚠️ Muss auf dem GRUND laufen, bevor die Schrift darin steht -- sonst ist der
    hellste Punkt im Kasten der Titel selbst und jede Messung ergibt 1,0:1.
    """
    x0, y0, x1, y1 = box
    crop = img.convert("RGB").crop((max(0, x0), max(0, y0), min(W, x1), min(H, y1)))
    # Nur die tatsaechlich vorkommenden Farben pruefen, nicht jeden Bildpunkt.
    brightest = max((c for _, c in crop.getcolors(maxcolors=1 << 24)), key=rel_lum)
    return contrast(fg, brightest)


# --- Bild -------------------------------------------------------------------
def build() -> Image.Image:
    atlas = Atlas()
    img = ground_layer().convert("RGBA")

    # Vignette: nach aussen abdunkeln, damit die Mitte traegt.
    vig = Image.new("L", (W, H), 0)
    dv = ImageDraw.Draw(vig)
    for i in range(60):
        t = i / 59
        dv.ellipse([-W * .35 + t * W * .40, -H * .55 + t * H * .60,
                    W * 1.35 - t * W * .40, H * 1.55 - t * H * .60], outline=int(76 * t))
    img.alpha_composite(Image.merge("RGBA", (
        Image.new("L", (W, H), GROUND[0]), Image.new("L", (W, H), GROUND[1]),
        Image.new("L", (W, H), GROUND[2]), vig.filter(ImageFilter.GaussianBlur(40)))))

    # Schleier links: Text braucht einen ruhigen Grund, Gras ist unruhig.
    # Voll deckend bis SCRIM_SOLID, danach eine LANGE smoothstep-Blende.
    # Der erste Versuch fiel ueber 310 px von deckend auf null -- das las sich
    # als senkrechte Naht mitten im Bild, als waeren zwei Haelften geklebt.
    # Die deckende Zone darf ruhig bis hinter den Titel reichen: der Hund wird
    # ERST DANACH gesetzt und bleibt deshalb unangetastet hell.
    SCRIM_SOLID, SCRIM_END = 624, 1170
    scrim = Image.new("L", (W, H), 0)
    ds = ImageDraw.Draw(scrim)
    for x in range(W):
        if x <= SCRIM_SOLID:
            a = 252
        else:
            t = 1 - (x - SCRIM_SOLID) / (SCRIM_END - SCRIM_SOLID)
            t = max(0.0, min(1.0, t))
            a = int(252 * (t * t * (3 - 2 * t)))        # smoothstep
        ds.line([(x, 0), (x, H)], fill=a)
    img.alpha_composite(Image.merge("RGBA", (
        Image.new("L", (W, H), 0x0C), Image.new("L", (W, H), 0x11),
        Image.new("L", (W, H), 0x0E), scrim)))

    # Warmes Streiflicht hinter dem Hund, damit er nicht in der Blende absackt.
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([700, 120, 1320, 640], fill=48)
    img.alpha_composite(Image.merge("RGBA", (
        Image.new("L", (W, H), 0x9A), Image.new("L", (W, H), 0xC0),
        Image.new("L", (W, H), 0x88), glow.filter(ImageFilter.GaussianBlur(110)))))

    # --- Hund: laeuft nach LINKS, also in die Schrift hinein ---------------
    # Ganz im Bild. Vorher ragte ein Drittel des Koerpers rechts hinaus -- das
    # las sich nicht als Schwung, sondern als Schnittfehler.
    dog = atlas.scaled("run1", 322, flip=True)
    dx = W - dog.width - 8                 # linke Kante des Sprites
    dy = 592                               # Bodenlinie unter den Pfoten
    shadow(img, dx + dog.width // 2, dy - 14, 190, 26, 135)
    img.alpha_composite(dog, (dx, dy - dog.height))

    # KEIN Knochen im Maul: die Schnauzenspitze liegt (im Sprite gemessen) bei
    # Bild-(595, 342) und damit genau dort, wo der Titel endet -- der Knochen
    # sass entweder auf dem Wort oder schwebte sichtbar daneben. Die zwei
    # liegenden Knochen erzaehlen die Jagd klarer als ein geklemmter.
    for bx, by, bh, a in ((648, 606, 36, 140), (1042, 318, 27, 105)):
        b = atlas.scaled("bone", bh)
        shadow(img, bx + b.width // 2, by + 4, int(b.width * .55), 8, a)
        img.alpha_composite(b, (bx, by - b.height))

    return img


# --- Satz -------------------------------------------------------------------
# EINE Layout-Quelle: die Messung prueft exakt die Kaesten, die auch gesetzt
# werden. Getrennt gepflegte Kaesten laufen frueher oder spaeter auseinander.
X = 76


def layout():
    f_title = font(112, "heavy")   # 124 lief bis x=675 in den Kopf des Hundes (658)
    f_sub = font(30, "medium")
    f_meta = font(23, "bold")
    # Drei kurze Zeilen statt zwei langen: die lange zweite Zeile lief bis
    # x=737 und damit unter den Knochen im Maul des Hundes (gemessen 1,5:1).
    sub = ("Knochen holen. Heimbringen.\n"
           "Wer dir in die Quere kommt,\nwird gebissen.")
    meta_tail = "   \u00b7   2\u20138 Hunde   \u00b7   3 Minuten   \u00b7   ohne Konto"
    return [
        # name,        farbe, xy,          schrift,  text,        grenze
        ("Titel",      TEXT,  (X, 196),    f_title,  "Brum",      3.0),
        ("Titel2",     MINT,  None,        f_title,  "mer",       3.0),
        ("Untertitel", DIM,   (X, 352),    f_sub,    sub,         4.5),
        ("Adresse",    MINT,  (X, 514),    f_meta,   "brummer.celox.io", 4.5),
        ("Fusszeile",  DIM,   (X, 556),    f_meta,   meta_tail,   4.5),
    ]


def placed(d):
    """Liefert (name, farbe, xy, schrift, text, grenze, kasten) -- die
    Fortsetzungen (xy None) haengen an ihrem Vorgaenger."""
    out, pen = [], None
    for name, col, xy, f, text, need in layout():
        if xy is None:
            xy = pen
        x, y = xy
        box = d.textbbox((x, y), text, font=f, spacing=12)
        out.append((name, col, (x, y), f, text, need, box))
        pen = (box[2], y)
    return out


def draw_type(img: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(img)
    for _n, col, xy, f, text, _need, _b in placed(d):
        d.text(xy, text, font=f, fill=col, spacing=12)
    return img


def main() -> None:
    img = build()

    # Kontrast auf dem GRUND messen -- vor dem Satz, sonst misst man die
    # Schrift gegen sich selbst (erster Versuch: durchweg 1,0:1).
    probe = ImageDraw.Draw(img)
    worst_ok = True
    for name, col, _xy, _f, _t, need, box in placed(probe):
        pad = (-6, -6, 6, 6)
        b = tuple(v + p for v, p in zip(box, pad))
        r = worst_contrast(img, col, b)
        ok = r >= need
        worst_ok &= ok
        print(f"  {'ok ' if ok else 'ZU SCHWACH'} {name:<11} {r:5.1f}:1  (noetig {need})")

    img = draw_type(img)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    kb = OUT.stat().st_size / 1024
    print(f"-> {OUT.relative_to(ROOT)}  {img.width}x{img.height}  {kb:.0f} kB")
    if not worst_ok:
        sys.exit("Kontrast unter der Grenze -- Schleier oder Farbe nachziehen")


if __name__ == "__main__":
    main()
