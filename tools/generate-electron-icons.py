#!/usr/bin/env python3
"""Regenerate the Electron STABLE app icons from the NotesGraph brand mark
(replacing the AFFiNE triangle). Mark drawing is copied verbatim from
tools/generate-brand-favicons.py so the glyph stays identical to the favicons.
"""
from PIL import Image, ImageDraw
import os

SS = 4
PURPLE = (139, 125, 255, 255)
BLUE = (50, 193, 241, 255)
BG = (20, 20, 28, 255)

# App-icon proportions: a bit larger mark than the favicon (0.38) so it reads
# well at dock/Finder sizes.
CONTENT = 0.5
STROKE = 0.072


def draw_tile(px, content=CONTENT, stroke=STROKE, radius_frac=0.23,
              full_bleed=False):
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
        col = tuple(int(PURPLE[k] + (BLUE[k] - PURPLE[k]) * t) for k in range(3)) + (255,)
        d.line([p0, p1], fill=col, width=w)
        r = w / 2
        for p in (p0, p1):
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)
    r = w * 1.3
    d.ellipse([tr[0] - r, tr[1] - r, tr[0] + r, tr[1] + r], fill=BLUE)
    return img.resize((px, px), Image.LANCZOS)


OUT = "packages/frontend/apps/electron/resources/icons"
ICONSET = "/tmp/NotesGraphIcon.iconset"
os.makedirs(ICONSET, exist_ok=True)

# macOS .iconset members
for px, name in [
    (16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'),
    (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'),
    (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
    (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'),
    (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png'),
]:
    draw_tile(px).save(os.path.join(ICONSET, name))

# standalone PNGs the make-env stable paths reference
draw_tile(1024).save(os.path.join(OUT, 'icon.png'))
draw_tile(512).save(os.path.join(OUT, 'icon_stable_512x512.png'))
draw_tile(64).save(os.path.join(OUT, 'icon_stable_64x64.png'))

# multi-size .ico (Windows / installer)
draw_tile(256).save(os.path.join(OUT, 'icon.ico'),
                    sizes=[(16, 16), (32, 32), (48, 48), (64, 64),
                           (128, 128), (256, 256)])

print("wrote iconset to", ICONSET, "and PNG/ICO to", OUT)

# After running: iconutil -c icns /tmp/NotesGraphIcon.iconset -o packages/frontend/apps/electron/resources/icons/icon.icns
