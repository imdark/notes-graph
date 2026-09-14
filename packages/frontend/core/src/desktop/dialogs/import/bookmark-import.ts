import { Text, type Workspace } from '@blocksuite/notesgraph/store';

type BookmarkNode =
  | { type: 'folder'; title: string; children: BookmarkNode[] }
  | { type: 'bookmark'; title: string; url: string };

/**
 * Parse a Netscape bookmark file (the HTML format every browser exports). The
 * structure is nested `<DL>` lists: `<DT><H3>folder</H3>` followed by the
 * folder's `<DL>`, and `<DT><A HREF="...">title</A>` for bookmarks. Browsers
 * emit slightly malformed HTML (unclosed `<DT>`), so the folder's `<DL>` may be
 * parsed either inside the `<DT>` or as its next sibling — both are handled.
 */
function parseBookmarks(html: string): BookmarkNode[] {
  const dom = new DOMParser().parseFromString(html, 'text/html');

  const parseList = (dl: Element): BookmarkNode[] => {
    const nodes: BookmarkNode[] = [];
    // Browsers emit stray <p> wrappers and nest a folder's <dl> inside its
    // <dt>, so the items aren't direct children. Take every <dt> whose nearest
    // ancestor <dl> is this one (i.e. not already inside a sub-folder's list).
    const items = Array.from(dl.querySelectorAll('dt')).filter(
      dt => dt.closest('dl') === dl
    );
    for (const dt of items) {
      const header = dt.querySelector(':scope > h3');
      const anchor = dt.querySelector(':scope > a');
      if (header) {
        const sublist = dt.querySelector(':scope > dl');
        nodes.push({
          type: 'folder',
          title: header.textContent?.trim() || 'Folder',
          children: sublist ? parseList(sublist) : [],
        });
      } else if (anchor) {
        const url = anchor.getAttribute('href');
        if (url) {
          nodes.push({
            type: 'bookmark',
            title: anchor.textContent?.trim() || url,
            url,
          });
        }
      }
    }
    return nodes;
  };

  const rootList = dom.querySelector('dl');
  return rootList ? parseList(rootList) : [];
}

/**
 * Import a browser bookmarks HTML file, preserving the folder hierarchy. Each
 * folder becomes a doc; bookmarks become bookmark cards inside their folder
 * doc; subfolders are linked from their parent (so they nest in the note tree).
 * Everything hangs off a single "Bookmarks" root doc.
 */
export async function importBookmarks(
  collection: Workspace,
  html: string
): Promise<{ docIds: string[]; entryId?: string }> {
  const tree = parseBookmarks(html);
  const docIds: string[] = [];

  const createFolderDoc = (title: string) => {
    const doc = collection.createDoc();
    doc.load();
    const store = doc.getStore();
    const rootId = store.addBlock('notesgraph:page', {
      title: new Text(title),
    });
    collection.meta.setDocMeta(doc.id, { title });
    store.addBlock('notesgraph:surface', {}, rootId);
    const noteId = store.addBlock(
      'notesgraph:note',
      { xywh: '[0, 0, 800, 640]' },
      rootId
    );
    docIds.push(doc.id);
    return { id: doc.id, store, noteId };
  };

  type Folder = ReturnType<typeof createFolderDoc>;

  const fill = (nodes: BookmarkNode[], folder: Folder) => {
    for (const node of nodes) {
      if (node.type === 'bookmark') {
        folder.store.addBlock(
          'notesgraph:bookmark',
          { url: node.url },
          folder.noteId
        );
      } else {
        const child = createFolderDoc(node.title);
        fill(node.children, child);
        // Link parent -> child so the folder nests in the sidebar note tree.
        folder.store.addBlock(
          'notesgraph:embed-linked-doc',
          { pageId: child.id },
          folder.noteId
        );
      }
    }
  };

  const root = createFolderDoc('Bookmarks');
  fill(tree, root);

  return { docIds, entryId: root.id };
}
