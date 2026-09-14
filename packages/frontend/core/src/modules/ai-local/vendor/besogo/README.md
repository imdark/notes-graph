# Vendored besogo

[besogo](https://github.com/yewang/besogo) — an embeddable SGF editor / Go board
viewer by Ye Wang. MIT licensed (see ./LICENSE).

These assets are committed (not pulled from a CDN) so the Go-board widget is
self-contained: the HTML-preview iframe inlines this JS + CSS and renders the
board as SVG, with no external scripts and no network at view time.

- `besogo.all.min.js.txt` — the 15 `/js/*.js` sources (besogo.js first to set up
  the `window.besogo` namespace), concatenated and minified with esbuild.
- `besogo.css.txt` — `css/besogo.css` + the `css/board-flat.css` theme.

Imported as raw strings via rspack `asset/source` (`*.txt`). To refresh, re-run
the fetch+concat+minify against a pinned besogo commit and re-test the API
surface (`besogo.create`, `besogo.autoInit`, `besogo.composeSgf`).
