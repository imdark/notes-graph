/**
 * The `<script type="importmap">` block from the built app HTML.
 *
 * The web build's template (tools/cli/src/rspack-shared/template.html) carries
 * an import map that points `react` & co. at the host's shared instance, so a
 * plugin loaded with import() renders into the host's React. Routes under
 * /workspace are not served that file: DocRendererController writes its own
 * HTML for link previews. Without the map there, a tab opened on a doc or
 * journal URL failed every plugin with "Failed to resolve module specifier
 * 'react'", while one opened on / worked.
 *
 * Lifted from the built file rather than copied, so the two cannot drift when
 * the map changes. Returns '' when there is none (dev without a web build).
 */
export function extractImportMap(html: string): string {
  return (
    html.match(
      /<script\s+type=["']importmap["'][^>]*>[\s\S]*?<\/script>/i
    )?.[0] ?? ''
  );
}
