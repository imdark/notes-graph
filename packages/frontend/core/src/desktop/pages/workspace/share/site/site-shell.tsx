import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import type { SiteManifest } from '@notesgraph/core/modules/share-doc';
import clsx from 'clsx';
import { useTheme } from 'next-themes';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import * as styles from './site-shell.css';
import { buildSiteTree, type SiteTreeNode } from './site-tree';

const FONT_FAMILY: Record<string, string> = {
  Sans: 'var(--affine-font-sans-family)',
  Serif: 'var(--affine-font-serif-family)',
  Mono: 'var(--affine-font-mono-family)',
};

/** Force the app color scheme while a forced-scheme site is on screen. */
function useForcedScheme(scheme: SiteManifest['site']['theme']['colorScheme']) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (scheme === 'auto') return;
    setTheme(scheme);
    // Restore the visitor's own preference when leaving the site.
    return () => setTheme('system');
  }, [scheme, setTheme]);
}

const SiteNavItem = ({
  node,
  depth,
  activeDocId,
  onNavigate,
}: {
  node: SiteTreeNode;
  depth: number;
  activeDocId: string;
  onNavigate: (docId: string) => void;
}) => (
  <>
    <button
      className={clsx(styles.navItem, {
        [styles.navItemActive]: node.docId === activeDocId,
      })}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => onNavigate(node.docId)}
      data-testid="site-nav-item"
      data-active={node.docId === activeDocId}
    >
      {node.title || 'Untitled'}
    </button>
    {node.children.map(child => (
      <SiteNavItem
        key={child.docId}
        node={child}
        depth={depth + 1}
        activeDocId={activeDocId}
        onNavigate={onNavigate}
      />
    ))}
  </>
);

/**
 * The public multi-page site chrome: a themed wrapper with a left side-menu
 * listing the folder's pages, around the readonly editor for the active page.
 * Navigating a menu item routes to that (already public) page.
 */
export const SiteShell = ({
  manifest,
  activeDocId,
  workspaceId,
  children,
}: {
  manifest: SiteManifest;
  activeDocId: string;
  workspaceId: string;
  children: ReactNode;
}) => {
  const { theme } = manifest.site;
  const { openPage } = useNavigateHelper();
  useForcedScheme(theme.colorScheme);

  const tree = useMemo(() => buildSiteTree(manifest.pages), [manifest.pages]);

  const wrapperStyle = useMemo<CSSProperties>(() => {
    const s: Record<string, string> = {
      fontFamily: FONT_FAMILY[theme.font] ?? FONT_FAMILY.Sans,
    };
    if (theme.accent) s['--affine-primary-color'] = theme.accent;
    if (theme.pageWidth === 'full') s['--notesgraph-n'] = '100%';
    return s as CSSProperties;
  }, [theme.accent, theme.font, theme.pageWidth]);

  const showSidebar = theme.showSidebar !== false;

  return (
    <div className={styles.shell} style={wrapperStyle} data-testid="site-shell">
      {showSidebar ? (
        <aside className={styles.sidebar} data-testid="site-sidebar">
          <div className={styles.siteTitle}>
            {manifest.site.title || 'Site'}
          </div>
          <nav className={styles.nav}>
            {tree.map(node => (
              <SiteNavItem
                key={node.docId}
                node={node}
                depth={0}
                activeDocId={activeDocId}
                onNavigate={docId => {
                  if (docId !== activeDocId) openPage(workspaceId, docId);
                }}
              />
            ))}
          </nav>
        </aside>
      ) : null}
      <div className={styles.content}>{children}</div>
    </div>
  );
};
