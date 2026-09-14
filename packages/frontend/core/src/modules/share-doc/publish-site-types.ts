/**
 * Types for "publish a folder as a site": a root doc plus every note reachable
 * from it (its outgoing-link subtree) published together as one multi-page,
 * themed public website with a side-menu.
 *
 * Two homes for this data, by necessity (see the design):
 *  - **Authoring** (editable, reactive): `docProperties.publishSite` in the local
 *    ORM — drives the share-menu panel. Never reaches an anonymous visitor.
 *  - **Serving** (anonymous): a `notesgraph:site` Y.Map on the doc CRDT, which
 *    *is* streamed to public visitors via `/api/workspaces/.../public-docs/:id`.
 *    The root doc carries the full {@link SiteManifest}; every page carries just
 *    a `root` pointer back to it.
 */

/** Theme/design presets applied to the published site shell. */
export interface SiteTheme {
  /** Force a scheme, or follow the visitor's system preference. */
  colorScheme: 'light' | 'dark' | 'auto';
  /** Accent color (hex) → overrides `--affine-primary-color` on the shell. */
  accent?: string;
  /** Reuses the editor-setting font families. */
  font: 'Sans' | 'Serif' | 'Mono';
  pageWidth: 'standard' | 'full';
  /** Hide the side-menu for a single-column reading site. */
  showSidebar: boolean;
}

/** Authoring-side settings, stored on the root doc's properties. */
export interface PublishSiteSettings {
  enabled: boolean;
  /** The page shown at the site root; defaults to the folder root doc. */
  homeDocId: string;
  /** Site name in the side-menu header; defaults to the root doc title. */
  title?: string;
  theme: SiteTheme;
}

/** One page in the published site, captured at publish time (title included so
 * an anonymous visitor renders the menu without loading every doc). */
export interface SiteManifestPage {
  docId: string;
  title: string;
  /** Nearest ancestor that is also in the site, or null for a top-level page. */
  parentId: string | null;
  order: number;
}

/** The full site descriptor written to the root doc's `notesgraph:site` map. */
export interface SiteManifest {
  version: 1;
  rootId: string;
  site: PublishSiteSettings;
  pages: SiteManifestPage[];
}

export const DEFAULT_SITE_THEME: SiteTheme = {
  colorScheme: 'auto',
  font: 'Sans',
  pageWidth: 'standard',
  showSidebar: true,
};

/** Notes tagged with this skip auto-publishing (the draft escape hatch). */
export const SITE_DRAFT_TAG = 'draft';

/** Top-level Y.Map key on a doc CRDT holding site data (manifest or pointer). */
export const SITE_MAP_KEY = 'notesgraph:site';
