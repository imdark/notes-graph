import { EmbedWebIcon, LockIcon } from '@blocksuite/icons/rc';
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  notify,
  Switch,
} from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { DocService } from '@notesgraph/core/modules/doc';
import {
  DEFAULT_SITE_THEME,
  type PublishSiteSettings,
  PublishSiteService,
  type SiteTheme,
} from '@notesgraph/core/modules/share-doc';
import { UserFriendlyError } from '@notesgraph/error';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import * as styles from './publish-site-section.css';
import { rowContainerStyle, labelStyle } from './styles.css';

const COLOR_SCHEMES: { value: SiteTheme['colorScheme']; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const FONTS: { value: SiteTheme['font']; label: string }[] = [
  { value: 'Sans', label: 'Sans' },
  { value: 'Serif', label: 'Serif' },
  { value: 'Mono', label: 'Mono' },
];
const WIDTHS: { value: SiteTheme['pageWidth']; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full width' },
];
// A small accent palette; empty string = theme default.
const ACCENTS = ['', '#1e96eb', '#7c3aed', '#059669', '#dc2626', '#d97706'];

const defaultSettings = (title: string): PublishSiteSettings => ({
  enabled: true,
  homeDocId: '',
  title,
  theme: { ...DEFAULT_SITE_THEME },
});

/**
 * "Publish this doc + everything under it as a site." Bulk-publishes the
 * doc-link subtree and exposes theme presets for the public site shell.
 */
export const PublishSiteSection = ({ disabled }: { disabled?: boolean }) => {
  const docService = useService(DocService);
  const publishSite = useService(PublishSiteService);
  const rootId = docService.doc.id;
  const docTitle = useLiveData(docService.doc.title$);

  const settings = useLiveData(
    useMemo(() => publishSite.siteSettings$(rootId), [publishSite, rootId])
  );
  const enabled = !!settings?.enabled;
  const theme = settings?.theme ?? DEFAULT_SITE_THEME;

  const onPublish = useAsyncCallback(async () => {
    try {
      const { published } = await publishSite.publishSite(
        rootId,
        settings ? { ...settings, enabled: true } : defaultSettings(docTitle)
      );
      notify.success({
        title: 'Published as site',
        message: `${published} page${published === 1 ? '' : 's'} are now public.`,
      });
    } catch (error) {
      const err = UserFriendlyError.fromAny(error);
      notify.error({ title: err.name, message: err.message });
    }
  }, [docTitle, publishSite, rootId, settings]);

  const onUnpublish = useAsyncCallback(async () => {
    try {
      await publishSite.unpublishSite(rootId);
      notify.success({ title: 'Site unpublished' });
    } catch (error) {
      const err = UserFriendlyError.fromAny(error);
      notify.error({ title: err.name, message: err.message });
    }
  }, [publishSite, rootId]);

  const onResync = useAsyncCallback(async () => {
    await publishSite.resyncSite(rootId);
    notify.success({ title: 'Site updated' });
  }, [publishSite, rootId]);

  const patch = useAsyncCallback(
    async (partial: Partial<PublishSiteSettings>, themePart?: Partial<SiteTheme>) => {
      if (!settings) return;
      await publishSite.updateSiteSettings(rootId, {
        ...settings,
        ...partial,
        theme: { ...settings.theme, ...themePart },
      });
    },
    [publishSite, rootId, settings]
  );

  const stateLabel = enabled ? 'Published as site' : 'Not a site';

  const setTitle = useCallback(
    (value: string) => void patch({ title: value }),
    [patch]
  );

  return (
    <>
      <div className={rowContainerStyle}>
        <div className={labelStyle}>Publish folder as site</div>
        {disabled ? (
          <div className={styles.disabledTrigger}>{stateLabel}</div>
        ) : (
          <Menu
            contentOptions={{ align: 'end' }}
            items={
              <>
                <MenuItem
                  prefixIcon={<LockIcon />}
                  onSelect={onUnpublish}
                  selected={!enabled}
                >
                  Not a site
                </MenuItem>
                <MenuItem
                  prefixIcon={<EmbedWebIcon />}
                  onSelect={onPublish}
                  selected={enabled}
                  data-testid="publish-site-enable"
                >
                  Publish this doc + descendants
                </MenuItem>
              </>
            }
          >
            <MenuTrigger
              className={styles.trigger}
              variant="plain"
              data-testid="publish-site-trigger"
              contentStyle={{ width: '100%' }}
            >
              {stateLabel}
            </MenuTrigger>
          </Menu>
        )}
      </div>

      {enabled && !disabled ? (
        <div className={styles.themePanel} data-testid="publish-site-theme">
          <Input
            value={settings?.title ?? ''}
            onChange={setTitle}
            placeholder="Site title"
            size="large"
          />

          <ThemeSelectRow
            label="Appearance"
            value={theme.colorScheme}
            options={COLOR_SCHEMES}
            onSelect={v => patch({}, { colorScheme: v })}
          />
          <ThemeSelectRow
            label="Font"
            value={theme.font}
            options={FONTS}
            onSelect={v => patch({}, { font: v })}
          />
          <ThemeSelectRow
            label="Width"
            value={theme.pageWidth}
            options={WIDTHS}
            onSelect={v => patch({}, { pageWidth: v })}
          />

          <div className={rowContainerStyle}>
            <div className={labelStyle}>Accent</div>
            <div className={styles.swatchRow}>
              {ACCENTS.map(color => (
                <button
                  key={color || 'default'}
                  className={styles.swatch}
                  data-active={(theme.accent ?? '') === color}
                  style={{
                    background: color || 'var(--affine-primary-color)',
                    opacity: color ? 1 : 0.5,
                  }}
                  onClick={() => void patch({}, { accent: color || undefined })}
                  aria-label={color || 'default'}
                />
              ))}
            </div>
          </div>

          <div className={rowContainerStyle}>
            <div className={labelStyle}>Side menu</div>
            <Switch
              checked={theme.showSidebar}
              onChange={v => void patch({}, { showSidebar: v })}
            />
          </div>

          <Button onClick={onResync} className={styles.resyncButton}>
            Re-sync pages
          </Button>
        </div>
      ) : null}
    </>
  );
};

function ThemeSelectRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
}) {
  const current = options.find(o => o.value === value)?.label ?? value;
  return (
    <div className={rowContainerStyle}>
      <div className={labelStyle}>{label}</div>
      <Menu
        contentOptions={{ align: 'end' }}
        items={options.map(o => (
          <MenuItem
            key={o.value}
            selected={o.value === value}
            onSelect={() => onSelect(o.value)}
          >
            {o.label}
          </MenuItem>
        ))}
      >
        <MenuTrigger variant="plain" className={styles.trigger}>
          {current}
        </MenuTrigger>
      </Menu>
    </div>
  );
}
