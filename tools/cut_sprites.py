#!/usr/bin/env python3
"""
Brummer asset pipeline, step 1: sheet -> freigestellte Einzelframes.

Die Blaetter sind JPEGs auf einfarbigem Grund. Wir
  1. schneiden das 4x4-Raster (Zellen 688x384, Hilfslinien 2px),
  2. stellen per FLUTFUELLUNG von den Raendern frei (nicht global ersetzen --
     sonst reisst es Loecher in alles im Hund, was zufaellig aehnlich hell ist),
  3. entfernen den gruenen JPEG-Saum an der Kontur (Despill + weiche Kante),
  4. beschneiden auf Inhalt und merken uns den Drehpunkt auf der BODENLINIE
     (nicht Bounding-Box-Mitte -- sonst zappelt der Hund beim Animieren).
"""
import json, math, os, sys
from collections import deque
from PIL import Image

ART = os.path.join(os.path.dirname(__file__), "..", "artwork")
OUT = os.path.join(os.path.dirname(__file__), "..", "build", "frames")

# Welche Blaetter, welches Raster, und wie die Zellen heissen.
# v5 ist byte-identisch mit v4 -> bewusst nicht in der Liste.
SHEETS = [
    ("lr-sprite-v4-optimized.jpg", 4, 4, "v4"),
    ("lr-sprite-optimized.jpg",    4, 4, "s1"),
    ("lr-sprite-v2-optimized.jpg", 4, 4, "v2"),
    ("lr-sprite-v3-optimized.jpg", 4, 4, "v3"),
    ("lr-emo-sprite-optimized.jpg", 4, 2, "emo"),
    # Front- und Rueckansichten (2026-08-20 erzeugt, s. docs/neue-sprites.md).
    # 4 Spalten x 3 Zeilen: Gehen vorn, Gehen hinten, Galopp.
    ("lr-front-back.jpg", 4, 3, "fb"),
]

GUIDE = 3        # px, Hilfslinien-Rand pro Zelle wegschneiden
TOL   = 34       # Farbtoleranz der Flutfuellung (JPEG rauscht um +-3, Kanten mehr)
SOFT  = 62       # ab hier gilt ein Pixel als "voll Vordergrund"

# Die Blaetter enthalten GEZEICHNETE Bodenschatten in Gruentoenen, die die
# Flutfuellung nicht erreicht (Reihe 3 von v4: eine grosse Ellipse; sonst kleine
# Klumpen unter den Pfoten). Sie sind HELL und gruen-dominant -- das Fell ist
# neutral (g == r == b), Zunge/Tan/Kupfer sind rot-dominant, das Tau-Halsband
# ist tuerkis (b ~= g). Nur die Kombination aus beidem trifft ausschliesslich
# Schatten: die dunklen Konturpixel haben durch JPEG ebenfalls Gruenstich,
# aber eine Helligkeit unter 60.
GREEN_DOM  = 8    # g - max(r,b)
GREEN_LUMA = 90   # darunter ist es Kontur, nicht Schatten
MIN_PART   = 0.90 # nur der Hund selbst; Staub/Speedlines macht die Engine


def bg_color(im):
    """Grundfarbe aus den vier Ecken mitteln."""
    w, h = im.size
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    cols = [im.getpixel(p) for p in pts]
    return tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))


def dist(a, b):
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)


def key_out(im, bg):
    """Flutfuellung von allen Randpixeln aus. Gibt eine Alpha-Maske zurueck."""
    w, h = im.size
    px = im.load()
    # 255 = Vordergrund, 0 = Hintergrund
    alpha = [[255] * w for _ in range(h)]
    seen = [[False] * w for _ in range(h)]
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if dist(px[x, y], bg) <= TOL and not seen[y][x]:
                seen[y][x] = True; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if dist(px[x, y], bg) <= TOL and not seen[y][x]:
                seen[y][x] = True; q.append((x, y))

    while q:
        x, y = q.popleft()
        alpha[y][x] = 0
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                if dist(px[nx, ny], bg) <= TOL:
                    seen[ny][nx] = True
                    q.append((nx, ny))

    # Gezeichnete Bodenschatten: hell + gruen-dominant.
    for y in range(h):
        for x in range(w):
            if alpha[y][x] == 0:
                continue
            r, g, b = px[x, y]
            if g - max(r, b) >= GREEN_DOM and (0.299*r + 0.587*g + 0.114*b) >= GREEN_LUMA:
                alpha[y][x] = 0

    # Uebrige Inselchen (Pfotenschatten, Rahmenreste) verwerfen.
    alpha = keep_big_parts(alpha, w, h)

    # Weiche Kante: Randpixel des Vordergrunds, die noch nach Grund riechen,
    # bekommen Teil-Alpha statt harter Treppe.
    for y in range(h):
        for x in range(w):
            if alpha[y][x] == 0:
                continue
            touches_bg = any(
                0 <= x+dx < w and 0 <= y+dy < h and alpha[y+dy][x+dx] == 0
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))
            )
            if touches_bg:
                d = dist(px[x, y], bg)
                if d < SOFT:
                    alpha[y][x] = max(0, min(255, int(255 * (d - TOL) / (SOFT - TOL))))
    return alpha


def keep_big_parts(alpha, w, h):
    """Nur die groesste zusammenhaengende Flaeche behalten -- plus alles, was
    mindestens MIN_PART davon ausmacht (Staubwolken, Knochen, Z-Z-Z)."""
    lab = [[-1] * w for _ in range(h)]
    sizes = []
    for sy in range(h):
        for sx in range(w):
            if alpha[sy][sx] == 0 or lab[sy][sx] != -1:
                continue
            idx = len(sizes)
            n = 0
            q = deque([(sx, sy)])
            lab[sy][sx] = idx
            while q:
                x, y = q.popleft()
                n += 1
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and lab[ny][nx] == -1 and alpha[ny][nx] != 0:
                        lab[ny][nx] = idx
                        q.append((nx, ny))
            sizes.append(n)
    if not sizes:
        return alpha
    big = max(sizes)
    keep = {i for i, n in enumerate(sizes) if n >= big * MIN_PART}
    for y in range(h):
        for x in range(w):
            if lab[y][x] != -1 and lab[y][x] not in keep:
                alpha[y][x] = 0
    return alpha


def despill(im, alpha, bg):
    """Gruenen Saum an halbtransparenten Kanten herausrechnen."""
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            a = alpha[y][x]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            r, g, b = px[x, y]
            if a < 255:
                # Farbe von der Grundfarbe wegziehen (un-premultiply)
                f = a / 255.0
                r = int(max(0, min(255, (r - bg[0] * (1 - f)) / f)))
                g = int(max(0, min(255, (g - bg[1] * (1 - f)) / f)))
                b = int(max(0, min(255, (b - bg[2] * (1 - f)) / f)))
            op[x, y] = (r, g, b, a)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for fname, cols, rows, tag in SHEETS:
        path = os.path.join(ART, fname)
        sheet = Image.open(path).convert("RGB")
        W, H = sheet.size
        cw, ch = W // cols, H // rows
        bg = bg_color(sheet)
        print(f"{fname}: {W}x{H} -> {cols}x{rows} Zellen a {cw}x{ch}, Grund {bg}")
        for r in range(rows):
            for c in range(cols):
                box = (c*cw + GUIDE, r*ch + GUIDE, (c+1)*cw - GUIDE, (r+1)*ch - GUIDE)
                cell = sheet.crop(box)
                a = key_out(cell, bg)
                rgba = despill(cell, a, bg)
                bbox = rgba.getbbox()
                if not bbox:
                    print(f"  {tag} r{r}c{c}: LEER, uebersprungen")
                    continue
                trimmed = rgba.crop(bbox)
                key = f"{tag}_r{r}c{c}"
                trimmed.save(os.path.join(OUT, key + ".png"))
                # Drehpunkt: Mitte der Breite, UNTERKANTE des Inhalts (Bodenlinie)
                manifest.append({
                    "key": key, "sheet": tag, "row": r, "col": c,
                    "w": trimmed.width, "h": trimmed.height,
                    "pivotX": round(trimmed.width / 2, 1),
                    "pivotY": trimmed.height,
                })
                print(f"  {key}: {trimmed.width}x{trimmed.height}")
    with open(os.path.join(OUT, "..", "frames.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n{len(manifest)} Frames -> build/frames/")


if __name__ == "__main__":
    main()
