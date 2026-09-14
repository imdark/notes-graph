import { applyUpdate, Doc as YDoc, encodeStateAsUpdate } from 'yjs';
import { describe, expect, test } from 'vitest';

import { buildSiteTree } from '../../../desktop/pages/workspace/share/site/site-tree';
import {
  DEFAULT_SITE_THEME,
  type SiteManifest,
} from '../publish-site-types';
import {
  clearSiteData,
  readSiteManifest,
  readSiteRootId,
  writeSiteManifest,
} from '../site-manifest';

const manifest = (rootId: string): SiteManifest => ({
  version: 1,
  rootId,
  site: {
    enabled: true,
    homeDocId: rootId,
    title: 'My Site',
    theme: { ...DEFAULT_SITE_THEME, accent: '#7c3aed' },
  },
  pages: [
    { docId: rootId, title: 'Home', parentId: null, order: 0 },
    { docId: 'a', title: 'A', parentId: rootId, order: 1 },
    { docId: 'b', title: 'B', parentId: rootId, order: 0 },
    { docId: 'a1', title: 'A1', parentId: 'a', order: 0 },
  ],
});

describe('site-manifest on a doc CRDT', () => {
  test('write → read round-trips the manifest and root pointer', () => {
    const yDoc = new YDoc();
    writeSiteManifest(yDoc, manifest('root'));

    expect(readSiteRootId(yDoc)).toBe('root');
    const read = readSiteManifest(yDoc);
    expect(read?.rootId).toBe('root');
    expect(read?.site.title).toBe('My Site');
    expect(read?.site.theme.accent).toBe('#7c3aed');
    expect(read?.pages).toHaveLength(4);
  });

  test('survives serialization across two independent Y.Docs (the sync path)', () => {
    const source = new YDoc();
    writeSiteManifest(source, manifest('root'));

    // Mimic what the anonymous visitor receives: only the encoded update.
    const target = new YDoc();
    applyUpdate(target, encodeStateAsUpdate(source));

    expect(readSiteManifest(target)?.pages).toHaveLength(4);
    expect(readSiteRootId(target)).toBe('root');
  });

  test('a plain doc has no site data', () => {
    const yDoc = new YDoc();
    expect(readSiteManifest(yDoc)).toBeNull();
    expect(readSiteRootId(yDoc)).toBeNull();
  });

  test('clearSiteData strips the manifest and pointer', () => {
    const yDoc = new YDoc();
    writeSiteManifest(yDoc, manifest('root'));
    clearSiteData(yDoc);
    expect(readSiteManifest(yDoc)).toBeNull();
    expect(readSiteRootId(yDoc)).toBeNull();
  });

  test('a malformed / future-version manifest reads as null', () => {
    const yDoc = new YDoc();
    yDoc.getMap<string>('notesgraph:site').set('manifest', '{not json');
    expect(readSiteManifest(yDoc)).toBeNull();

    const yDoc2 = new YDoc();
    yDoc2
      .getMap<string>('notesgraph:site')
      .set('manifest', JSON.stringify({ version: 2, pages: [] }));
    expect(readSiteManifest(yDoc2)).toBeNull();
  });
});

describe('buildSiteTree', () => {
  test('nests by parentId and sorts by order at each level', () => {
    const tree = buildSiteTree(manifest('root').pages);
    expect(tree.map(n => n.docId)).toEqual(['root']);
    // root's children sorted by order: B(0) before A(1)
    expect(tree[0].children.map(n => n.docId)).toEqual(['b', 'a']);
    // A's child
    const a = tree[0].children.find(n => n.docId === 'a');
    expect(a?.children.map(n => n.docId)).toEqual(['a1']);
  });

  test('an orphaned page (missing parent) surfaces at the top level', () => {
    const tree = buildSiteTree([
      { docId: 'x', title: 'X', parentId: 'gone', order: 0 },
    ]);
    expect(tree.map(n => n.docId)).toEqual(['x']);
  });
});
