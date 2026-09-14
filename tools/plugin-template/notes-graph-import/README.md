# Notes Graph Import

Imports a [mind-link](https://github.com/) notes-graph export into NotesGraph as
linked docs, so the NotesGraph graph view mirrors the original graph.

## Format

The mind-link export (`graph-notes-export-*.txt`) is JSON:

```json
{
  "nodes": [{ "_id": "n1", "name": "Title", "description": "Body text" }],
  "links": [{ "source": "n1", "target": "n2" }]
}
```

- **node** → a doc: `name` becomes the title, `description` a paragraph. Any
  URL in the description is embedded as a **link card** (bookmark, card mode).
- **link** `source → target` → an `notesgraph:embed-linked-doc` block in the source
  doc, which NotesGraph indexes as a reference (an edge in the graph view).

(Falls back to `id`/`title`/`content`/`text` and `from`/`to` for variant exports.)

## Use

1. Load/install the plugin (Settings → Plugins).
2. Open NotesGraph's **Import** dialog (sidebar import button) → **"Notes graph
   (JSON)"** (contributed via `ctx.ui.addImporter`) → pick the export file.
3. Open the **Graph** view to see the imported docs + links.

Declares `ui` + `docs` permissions. Plain ESM (no build step). The plugin adds
its import button through the host import API rather than modifying the dialog.
