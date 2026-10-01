#!/usr/bin/env python3
"""Render the NotesGraph app mark at logo sizes.

Same drawing as the favicon and launcher tile -- one continuous stroke "N"
carrying the purple->light-blue gradient, with the flat blue dot on the final
end, on the dark #14141C rounded tile -- just bigger, and under a name that
says what it is for rather than where it happens to be used.

These exist for places that need a standalone raster logo rather than a
favicon: the site header, and Google's OAuth consent screen, which only takes
a raster upload and then checks that the same logo appears on the site.

Run from the repo root.
"""
import os

from importlib.machinery import SourceFileLoader

# The favicon generator owns the drawing; importing it keeps the two from
# drifting into subtly different versions of the same mark.
_favicons = SourceFileLoader(
    "generate_brand_favicons",
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "generate-brand-favicons.py"),
).load_module()


def main() -> None:
    out = os.path.join("landing", "icons")
    os.makedirs(out, exist_ok=True)
    for px in (192, 512):
        path = os.path.join(out, f"app-logo-{px}.png")
        _favicons.draw_tile(px).save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
