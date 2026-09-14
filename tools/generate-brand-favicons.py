#!/usr/bin/env python3
"""Generate the NotesGraph favicon/PWA icon sets from the brand mark.

Same design as the Android launcher (tools/generate-android-launcher-icon.py):
one continuous stroke N with a purple->light-blue gradient along the path and
a flat light-blue dot on the final end, on the dark #14141C rounded tile.
Favicons use a larger mark fraction than the launcher so the glyph stays
legible at 16-48 px.

Outputs to landing/icons, packages/frontend/core/public and the electron
web-static copy. Run from the repo root.
"""
from PIL import Image, ImageDraw
import os

SS = 4
PURPLE = (139, 125, 255, 255)
BLUE = (50, 193, 241, 255)
BG = (20, 20, 28, 255)

# favicon proportions. Kept a touch bigger than the launcher's 0.30 for
# small-size legibility, but smaller + thinner than before per design.
CONTENT = 0.38
STROKE = 0.078


def draw_tile(px: int, content=CONTENT, stroke=STROKE, radius_frac=0.23,
              full_bleed=False) -> Image.Image:
    s = px * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_bleed:
        d.rectangle([0, 0, s, s], fill=BG)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac),
                            fill=BG)

    c = s / 2
    h = s * content / 2
    tl, bl, tr, br = (c - h, c - h), (c - h, c + h), (c + h, c - h), (c + h, c + h)
    path = [bl, tl, br, tr]
    segs = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        n = 60
        for t in range(n):
            segs.append((
                (a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n),
                (a[0] + (b[0] - a[0]) * (t + 1) / n,
                 a[1] + (b[1] - a[1]) * (t + 1) / n),
            ))
    w = int(s * stroke)
    for i, (p0, p1) in enumerate(segs):
        t = i / (len(segs) - 1)
        col = tuple(
            int(PURPLE[k] + (BLUE[k] - PURPLE[k]) * t) for k in range(3)
        ) + (255,)
        d.line([p0, p1], fill=col, width=w)
        r = w / 2
        for p in (p0, p1):
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)
    r = w * 1.3
    d.ellipse([tr[0] - r, tr[1] - r, tr[0] + r, tr[1] + r], fill=BLUE)
    return img.resize((px, px), Image.LANCZOS)


def emit(folder: str, sizes: list[int], with_32: bool):
    os.makedirs(folder, exist_ok=True)
    for px in sizes:
        draw_tile(px).save(os.path.join(folder, f"favicon-{px}.png"))
    if with_32:
        draw_tile(32).save(os.path.join(folder, "favicon-32.png"))
    # apple-touch-icon: iOS masks it itself — full-bleed square, 180px
    draw_tile(180, full_bleed=True).save(
        os.path.join(folder, "apple-touch-icon.png"))
    # multi-size ico
    draw_tile(48).save(os.path.join(folder, "favicon.ico"),
                       sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote", folder)


emit("landing/icons", [36, 48, 72, 96, 144, 192], with_32=False)
emit("packages/frontend/core/public", [36, 48, 72, 96, 144, 192], with_32=True)
emit("packages/frontend/apps/electron/resources/web-static",
     [36, 48, 72, 96, 144, 192], with_32=True)

# electron web-static also carries favicon.svg — copy the canonical one
import shutil
shutil.copy("packages/frontend/core/public/favicon.svg",
            "packages/frontend/apps/electron/resources/web-static/favicon.svg")
print("done")
