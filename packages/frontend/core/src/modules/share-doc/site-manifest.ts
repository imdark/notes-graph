import { type Doc as YDoc, Map as YMap } from 'yjs';

import { SITE_MAP_KEY, type SiteManifest } from './publish-site-types';

/**
 * Read/write the site descriptor on a doc's own CRDT (`yDoc`). This map is the
 * *only* channel that reaches an anonymous visitor — the public-doc endpoint
 * streams the doc binary, so whatever lives here ships with it. Doc *properties*
 * (local ORM) never do.
 *
 * Layout of the `notesgraph:site` Y.Map:
 *  - `root`     — id of the site's root doc (present on every page in the site)
 *  - `manifest` — JSON {@link SiteManifest} (present on the root doc only)
 */

const siteMap = (yDoc: YDoc): YMap<string> =>
  yDoc.getMap<string>(SITE_MAP_KEY);

/**
 * Every write here has to be a no-op when the stored value already matches.
 *
 * `Y.Map.set` is not idempotent: re-setting an identical value still produces a
 * new CRDT item and therefore a *local* transaction. A local transaction on a
 * doc is how the app decides the user edited it (`Doc`'s `afterTransaction`
 * hook stamps `updatedDate`), so an unconditional rewrite silently bumps the
 * doc's "Updated" time. Auto-publish re-runs `publishSite` on every workspace
 * init, which rewrites the manifest onto every page of the site — so without
 * these guards every published note jumps to the top of "Recent" on each app
 * open, for docs nobody touched. Skipping the transaction also keeps the
 * re-sync from pushing pointless updates to the server.
 */

/** Root doc: write the full manifest + mark itself as its own site root. */
export function writeSiteManifest(yDoc: YDoc, manifest: SiteManifest): void {
  const map = siteMap(yDoc);
  const json = JSON.stringify(manifest);
  if (map.get('root') === manifest.rootId && map.get('manifest') === json) {
    return;
  }
  yDoc.transact(() => {
    map.set('root', manifest.rootId);
    map.set('manifest', json);
  });
}

/** Descendant page: point back to the site root (no manifest copy). */
export function writeSitePointer(yDoc: YDoc, rootId: string): void {
  const map = siteMap(yDoc);
  if (map.get('root') === rootId) {
    return;
  }
  yDoc.transact(() => {
    map.set('root', rootId);
  });
}

/** Remove all site data from a doc (on unpublish / removal from a site). */
export function clearSiteData(yDoc: YDoc): void {
  const map = siteMap(yDoc);
  if (!map.has('root') && !map.has('manifest')) {
    return;
  }
  yDoc.transact(() => {
    map.delete('root');
    map.delete('manifest');
  });
}

/** The site root this doc belongs to, if any (works on root + descendants). */
export function readSiteRootId(yDoc: YDoc): string | null {
  return siteMap(yDoc).get('root') ?? null;
}

/** The full manifest, if this doc is a site root; null otherwise. */
export function readSiteManifest(yDoc: YDoc): SiteManifest | null {
  const raw = siteMap(yDoc).get('manifest');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SiteManifest;
    return parsed?.version === 1 && Array.isArray(parsed.pages) ? parsed : null;
  } catch {
    return null;
  }
}
