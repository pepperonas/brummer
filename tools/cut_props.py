#!/usr/bin/env python3
"""Schritt 1b: lose Gegenstaende (Knochen, Truhe) aus einzelnen Zellen holen.

Der Inselfilter aus cut_sprites.py wirft sie bewusst weg -- sie sind zu klein.
Hier holen wir sie gezielt: gleiche Freistellung, dann die Komponente greifen,
die NICHT der Hund ist.
"""
import os, sys
from collections import deque
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from cut_sprites import key_out, despill, bg_color, GUIDE, GREEN_DOM, GREEN_LUMA

ART = os.path.join(os.path.dirname(__file__), "..", "artwork")
OUT = os.path.join(os.path.dirname(__file__), "..", "build", "frames")

# (Blatt, cols, rows, row, col, Name, erwartete Lage 'rechts'|'unten-rechts')
PROPS = [
    ("lr-sprite-v2-optimized.jpg", 4, 4, 2, 3, "prop_bone"),
    ("lr-sprite-v3-optimized.jpg", 4, 4, 1, 3, "prop_chest"),
]


def components(alpha, w, h):
    lab = [[-1]*w for _ in range(h)]
    parts = []
    for sy in range(h):
        for sx in range(w):
            if alpha[sy][sx] == 0 or lab[sy][sx] != -1:
                continue
            idx = len(parts)
            px_list = []
            q = deque([(sx, sy)]); lab[sy][sx] = idx
            while q:
                x, y = q.popleft(); px_list.append((x, y))
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and lab[ny][nx] == -1 and alpha[ny][nx] != 0:
                        lab[ny][nx] = idx; q.append((nx, ny))
            parts.append(px_list)
    return parts


def main():
    os.makedirs(OUT, exist_ok=True)
    for fname, cols, rows, r, c, name in PROPS:
        sheet = Image.open(os.path.join(ART, fname)).convert("RGB")
        W, H = sheet.size
        cw, ch = W // cols, H // rows
        bg = bg_color(sheet)
        cell = sheet.crop((c*cw+GUIDE, r*ch+GUIDE, (c+1)*cw-GUIDE, (r+1)*ch-GUIDE))
        w, h = cell.size
        a = key_out(cell, bg)
        px = cell.load()
        for y in range(h):
            for x in range(w):
                if a[y][x] == 0: continue
                rr, gg, bb = px[x, y]
                if gg - max(rr, bb) >= GREEN_DOM and (0.299*rr+0.587*gg+0.114*bb) >= GREEN_LUMA:
                    a[y][x] = 0
        parts = components(a, w, h)
        parts.sort(key=len, reverse=True)
        print(f"{name}: {len(parts)} Komponenten, Groessen {[len(p) for p in parts[:6]]}")
        if len(parts) < 2:
            print("  -> keine zweite Komponente gefunden, uebersprungen"); continue
        # Der Hund ist die groesste. Der Gegenstand ist die groesste der uebrigen,
        # die weit genug rechts liegt (dort steht er auf beiden Blaettern).
        cand = [p for p in parts[1:] if len(p) > 400 and max(x for x, _ in p) > w*0.6]
        if not cand:
            cand = [p for p in parts[1:] if len(p) > 400]
        if not cand:
            print("  -> nichts Brauchbares"); continue
        obj = max(cand, key=len)
        keep = set(obj)
        a2 = [[a[y][x] if (x, y) in keep else 0 for x in range(w)] for y in range(h)]
        rgba = despill(cell, a2, bg)
        bb = rgba.getbbox()
        out = rgba.crop(bb)
        out.save(os.path.join(OUT, name + ".png"))
        print(f"  -> {name}.png {out.width}x{out.height} ({len(obj)} px)")


if __name__ == "__main__":
    main()
