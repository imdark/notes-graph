#!/usr/bin/env python3
"""Regenerate the Electron DMG install-window background with NotesGraph
branding (replacing the AFFiNE triangle/wordmark and the 'Drag to install
AFFiNE' text). Emits dmg-background.png (610x365) + @2x (1220x730)."""
from PIL import Image, ImageDraw, ImageFont
import os

SS = 4
OUT = "packages/frontend/apps/electron/resources/icons"
SFNS = "/System/Library/Fonts/SFNS.ttf"


def rsquare(size, radius, fill, alpha=255):
    s = size * SS
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius * SS, fill=fill + (alpha,))
    return im.resize((size, size), Image.LANCZOS)


def compose(scale):
    W, H = 610 * scale, 365 * scale
    img = Image.new("RGBA", (W, H), (244, 244, 247, 255))
    d = ImageDraw.Draw(img)
    # faint dot grid
    step = 22 * scale
    for y in range(step, H, step):
        for x in range(step, W, step):
            d.ellipse([x - scale, y - scale, x + scale, y + scale], fill=(150, 150, 160, 28))

    gray = (74, 74, 82, 255)
    # top wordmark — text only (no icon tile, per design)
    font = ImageFont.truetype(SFNS, 34 * scale)
    text = "NotesGraph"
    tb = d.textbbox((0, 0), text, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    cy = 52 * scale
    d.text(((W - tw) // 2 - tb[0], cy - th // 2 - tb[1]), text, font=font, fill=gray)

    # app drop placeholder (left) centered at (176,192) — where the maker drops the app icon
    ph = 104 * scale
    px, py = 176 * scale, 192 * scale
    shadow = rsquare(ph, 24 * scale, (0, 0, 0), alpha=26)
    img.alpha_composite(shadow, (px - ph // 2, py - ph // 2 + 4 * scale))
    plate = rsquare(ph, 24 * scale, (255, 255, 255), alpha=255)
    img.alpha_composite(plate, (px - ph // 2, py - ph // 2))

    # arrow → Applications
    ax, ay = 300 * scale, 192 * scale
    lw = 5 * scale
    d.line([(ax, ay), (ax + 62 * scale, ay)], fill=(150, 150, 160, 255), width=lw)
    hx = ax + 62 * scale
    d.line([(hx - 14 * scale, ay - 12 * scale), (hx, ay)], fill=(150, 150, 160, 255), width=lw)
    d.line([(hx - 14 * scale, ay + 12 * scale), (hx, ay)], fill=(150, 150, 160, 255), width=lw)

    # bottom instruction
    bf = ImageFont.truetype(SFNS, 15 * scale)
    bt = "Drag to install NotesGraph in your Applications folder"
    bb = d.textbbox((0, 0), bt, font=bf)
    d.text(((W - (bb[2] - bb[0])) // 2, 328 * scale), bt, font=bf, fill=(120, 120, 128, 255))
    return img


compose(1).save(os.path.join(OUT, "dmg-background.png"))
compose(2).save(os.path.join(OUT, "dmg-background@2x.png"))
print("wrote dmg-background.png + @2x")
