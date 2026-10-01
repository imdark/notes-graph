#!/usr/bin/env python3
"""Render the NotesGraph app mark (the graph "N") to PNG.

This is the mark the app itself shows -- four nodes wired into an "N" with one
accent node on the violet->cyan gradient (see
packages/frontend/component/src/components/brand/notesgraph-logo.tsx). It is a
different design from the favicon/launcher tile, which is a single continuous
stroke; both live in the repo on purpose.

The PNG exists for places that cannot take an SVG -- notably Google's OAuth
consent screen, which only accepts a raster upload and then checks that the
same logo appears on the site. landing/icons/app-logo.svg is the same drawing
for the web page itself.

Run from the repo root.
"""
from PIL import Image, ImageDraw
import os

SS = 4  # supersample factor, for antialiasing by downscale
BG = (20, 20, 28, 255)        # #14141C tile
EDGE = (139, 125, 255, 255)   # #8B7DFF strokes
NODE = (231, 231, 242, 255)   # #E7E7F2 plain nodes
VIOLET = (124, 108, 255)      # #7C6CFF gradient start
CYAN = (34, 211, 238)         # #22D3EE gradient end

# Geometry in the 48x48 design space the SVG uses.
LEFT, RIGHT, TOP, BOTTOM = 15, 33, 15, 33
EDGE_W = 3
NODE_R = 4.3
ACCENT_R = 5.2
RADIUS = 11


def render(px: int) -> Image.Image:
    s = px * SS
    k = s / 48  # design units -> supersampled pixels
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(RADIUS * k), fill=BG)

    w = int(EDGE_W * k)
    for a, b in (
        ((LEFT, TOP), (LEFT, BOTTOM)),    # left vertical
        ((LEFT, TOP), (RIGHT, BOTTOM)),   # diagonal
        ((RIGHT, TOP), (RIGHT, BOTTOM)),  # right vertical
    ):
        d.line([(a[0] * k, a[1] * k), (b[0] * k, b[1] * k)], fill=EDGE,
               width=w, joint="curve")

    for cx, cy in ((LEFT, TOP), (LEFT, BOTTOM), (RIGHT, BOTTOM)):
        r = NODE_R * k
        d.ellipse([cx * k - r, cy * k - r, cx * k + r, cy * k + r], fill=NODE)

    # The accent node carries the brand gradient, drawn as a clipped diagonal
    # ramp because PIL has no gradient fill.
    r = ACCENT_R * k
    box = int(r * 2) + 2
    ramp = Image.new("RGBA", (box, box))
    rd = ImageDraw.Draw(ramp)
    for i in range(box):
        t = i / max(box - 1, 1)
        rd.line([(i, 0), (0, i)],
                fill=tuple(int(VIOLET[c] + (CYAN[c] - VIOLET[c]) * t)
                           for c in range(3)) + (255,))
    for i in range(box):
        t = (box + i) / max(2 * box - 2, 1)
        rd.line([(box - 1, i), (i, box - 1)],
                fill=tuple(int(VIOLET[c] + (CYAN[c] - VIOLET[c]) * t)
                           for c in range(3)) + (255,))
    mask = Image.new("L", (box, box), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, box - 1, box - 1], fill=255)
    img.paste(ramp, (int(RIGHT * k - r) - 1, int(TOP * k - r) - 1), mask)

    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    out = os.path.join("landing", "icons")
    os.makedirs(out, exist_ok=True)
    for px in (192, 512):
        path = os.path.join(out, f"app-logo-{px}.png")
        render(px).save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
