#!/usr/bin/env python3
"""Generate the NotesGraph Android launcher icon.

Design ("one stroke, accent end"): the N drawn as one continuous rounded
stroke (bottom-left -> top-left -> bottom-right -> top-right) with the brand
gradient purple (#8B7DFF) -> light blue (#32C1F1) flowing along the path and
a flat light-blue node dot on the final stroke end. Mark spans ~30% of the
visible tile.

Regenerates the adaptive foreground plus legacy square/round icons for every
density. Run from the repo root:  python3 tools/generate-android-launcher-icon.py
"""
from PIL import Image, ImageDraw
import os

RES = "packages/frontend/apps/android/App/app/src/main/res"
SS = 4  # supersample factor

PURPLE = (139, 125, 255, 255)   # #8B7DFF stroke start
BLUE = (50, 193, 241, 255)      # #32C1F1 stroke end + accent dot
BG = (20, 20, 28, 255)          # #14141C

# Mark size as a fraction of the *visible* tile (legacy icon / launcher crop)
CONTENT = 0.30
STROKE = 0.068


def draw_mark(canvas_px: int, content: float, stroke: float) -> Image.Image:
    """One-stroke N with gradient + blue end dot, centered, transparent bg."""
    s = canvas_px * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    c = s / 2
    h = s * content / 2
    tl, bl, tr, br = (c - h, c - h), (c - h, c + h), (c + h, c - h), (c + h, c + h)

    path = [bl, tl, br, tr]
    segs = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        n = 60
        for t in range(n):
            p0 = (a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n)
            p1 = (a[0] + (b[0] - a[0]) * (t + 1) / n,
                  a[1] + (b[1] - a[1]) * (t + 1) / n)
            segs.append((p0, p1))

    w = int(s * stroke)

    def line(a, b, col):
        d.line([a, b], fill=col, width=w)
        r = w / 2
        for p in (a, b):
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)

    for i, (p0, p1) in enumerate(segs):
        t = i / (len(segs) - 1)
        col = tuple(
            int(PURPLE[k] + (BLUE[k] - PURPLE[k]) * t) for k in range(3)
        ) + (255,)
        line(p0, p1, col)

    r = w * 1.3
    d.ellipse([tr[0] - r, tr[1] - r, tr[0] + r, tr[1] + r], fill=BLUE)

    return img.resize((canvas_px, canvas_px), Image.LANCZOS)


def adaptive_foreground(px: int) -> Image.Image:
    # Launchers show the middle 72/108 of the adaptive canvas — scale the
    # visible-tile fractions accordingly.
    k = 72 / 108
    return draw_mark(px, CONTENT * k, STROKE * k)


def legacy(size: int, round_mask: bool) -> Image.Image:
    bg = Image.new("RGBA", (size, size), BG)
    bg.alpha_composite(draw_mark(size, CONTENT, STROKE))
    if round_mask:
        m = Image.new("L", (size * SS, size * SS), 0)
        ImageDraw.Draw(m).ellipse(
            [0, 0, size * SS - 1, size * SS - 1], fill=255
        )
        m = m.resize((size, size), Image.LANCZOS)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(bg, (0, 0), m)
        return out
    return bg


densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for dpi, mult in densities.items():
    folder = os.path.join(RES, f"mipmap-{dpi}")
    adaptive_foreground(int(108 * mult)).save(
        os.path.join(folder, "ic_launcher_foreground.webp"), "WEBP", lossless=True
    )
    legacy(int(48 * mult), False).save(
        os.path.join(folder, "ic_launcher.webp"), "WEBP", lossless=True
    )
    legacy(int(48 * mult), True).save(
        os.path.join(folder, "ic_launcher_round.webp"), "WEBP", lossless=True
    )
    print(dpi, "done")
print("all densities generated")

# Google Play listing icon: 512x512, full square, mark on the brand background.
# The Play console rejects alpha, so flatten to RGB.
legacy(512, False).convert("RGB").save(
    os.path.join(RES, "..", "ic_launcher-playstore.png"), "PNG"
)
print("playstore icon done")
