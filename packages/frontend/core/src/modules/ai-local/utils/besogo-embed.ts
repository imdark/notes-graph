import besogoJs from '../vendor/besogo/besogo.all.min.js.txt';
import besogoCss from '../vendor/besogo/besogo.css.txt';

/**
 * Build a self-contained HTML document that embeds the vendored
 * [besogo](https://github.com/yewang/besogo) SGF editor, seeded with `sgf`.
 *
 * Rendered through NotesGraph's `notesgraph:code` HTML-preview block (the same iframe
 * the AI HTML-artifact uses): the iframe is sandboxed with `allow-scripts`, so
 * the inline `<script>` runs, but external scripts are at the remote
 * container's mercy — hence besogo's JS + CSS are **inlined**, not pulled from a
 * CDN. besogo draws the board as SVG (flat stones, no image assets), so the
 * widget is fully offline and self-contained.
 *
 * Edits (add/remove stones, navigate variations) happen live inside the widget;
 * the user exports the result via besogo's "Save" button (file panel). Edits do
 * not write back into the NotesGraph block model.
 *
 * @param sgf  An SGF string (e.g. from {@link boardToSgf}).
 * @param size Board size (9/13/19). Passed to `besogo.create` so the editor is
 *   built at the detected size up front, rather than defaulting to 19 and then
 *   loading a smaller position.
 */
export function buildBesogoHtml(sgf: string, size: number): string {
  // Embed the SGF as a JS string literal. JSON.stringify handles quotes,
  // newlines and backslashes; escaping `<` additionally prevents any `</script>`
  // sequence in the SGF from breaking out of the inline script.
  const sgfLiteral = JSON.stringify(sgf).replace(/</g, '\\u003c');
  const sizeLiteral = JSON.stringify(size);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
#besogo-goban { width: 100%; box-sizing: border-box; }
${besogoCss}
</style>
</head>
<body>
<div id="besogo-goban"></div>
<script>${besogoJs}</script>
<script>
(function () {
  var el = document.getElementById('besogo-goban');
  if (!el || !window.besogo || typeof window.besogo.create !== 'function') return;
  try {
    window.besogo.create(el, {
      sgf: ${sgfLiteral},
      size: ${sizeLiteral},
      panels: 'control+tool+tree+file',
      tool: 'auto',
      coord: 'western'
    });
  } catch (e) {
    el.textContent = 'Could not render the Go board: ' + (e && e.message || e);
  }
})();
</script>
</body>
</html>`;
}
