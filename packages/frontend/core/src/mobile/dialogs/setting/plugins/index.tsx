import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { Button, notify, Switch } from '@notesgraph/component';
import {
  type InstalledPlugin,
  type MarketplaceEntry,
  PluginMarketplaceService,
  PluginService,
} from '@notesgraph/core/modules/plugin';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';
import { SwipeDialog } from '../swipe-dialog';
import * as styles from './styles.css';

/**
 * Plugins on the phone. Installed plugins are kept per device, so one
 * installed on the web is not on the phone until it is installed here too;
 * this is where that happens. Same two services as the desktop page
 * (desktop/dialogs/setting/general-setting/plugins), without the dev-plugin
 * URL field: there is no dev server to point a phone at.
 */
export const PluginsSetting = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingGroup title="Plugins">
        <RowLayout label="Plugins" onClick={() => setOpen(true)}>
          <ArrowRightSmallIcon fontSize={22} />
        </RowLayout>
      </SettingGroup>
      <SwipeDialog open={open} onOpenChange={setOpen} title="Plugins">
        {open ? <PluginsList /> : null}
      </SwipeDialog>
    </>
  );
};

const PluginsList = () => {
  const pluginService = useService(PluginService);
  const marketplaceService = useService(PluginMarketplaceService);
  const plugins = useLiveData(pluginService.plugins$);
  const [available, setAvailable] = useState<MarketplaceEntry[] | null>(null);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const installed = new Set(plugins.map(p => p.manifest.id));

  const refreshMarketplace = useCallback(() => {
    setMarketplaceError(null);
    marketplaceService
      .listAvailable()
      .then(entries => setAvailable(entries))
      .catch((err: unknown) => {
        // As on desktop: an unreachable marketplace is said, not shown as empty.
        setAvailable([]);
        setMarketplaceError(
          err instanceof Error
            ? err.message
            : 'Could not reach the marketplace.'
        );
      });
  }, [marketplaceService]);

  useEffect(() => {
    refreshMarketplace();
  }, [refreshMarketplace]);

  const install = useCallback(
    (entry: MarketplaceEntry) => {
      setInstallingId(entry.id);
      marketplaceService
        .install(entry)
        .then(() => setInstallingId(null))
        .catch((err: unknown) => {
          setInstallingId(null);
          notify.error({
            title: 'Failed to install plugin',
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [marketplaceService]
  );

  return (
    <div className={styles.content} data-testid="mobile-plugins">
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Marketplace</div>
        {available === null ? (
          <div className={styles.note}>Loading…</div>
        ) : marketplaceError ? (
          <div className={styles.item}>
            <div className={styles.itemHead}>
              <div className={styles.itemName}>Marketplace unavailable</div>
              <Button onClick={refreshMarketplace}>Try again</Button>
            </div>
            <div className={styles.error}>{marketplaceError}</div>
          </div>
        ) : available.length === 0 ? (
          <div className={styles.note}>
            No plugins available. The marketplace is reachable but has nothing
            published yet.
          </div>
        ) : (
          available.map(entry => (
            <div
              key={entry.id}
              className={styles.item}
              data-testid="mobile-plugin-available"
            >
              <div className={styles.itemHead}>
                <div className={styles.itemName}>{entry.name}</div>
                <div className={styles.itemActions}>
                  <Button
                    variant="primary"
                    disabled={installed.has(entry.id)}
                    loading={installingId === entry.id}
                    onClick={() => install(entry)}
                  >
                    {installed.has(entry.id) ? 'Installed' : 'Install'}
                  </Button>
                </div>
              </div>
              <div className={styles.itemMeta}>
                {`${entry.id} · v${entry.version}${entry.description ? ` · ${entry.description}` : ''}`}
              </div>
            </div>
          ))
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Installed</div>
        {plugins.length === 0 ? (
          <div className={styles.note}>
            No plugins installed. Install one from the marketplace above.
          </div>
        ) : (
          plugins.map(plugin => (
            <InstalledItem key={plugin.manifest.id} plugin={plugin} />
          ))
        )}
      </section>
    </div>
  );
};

const InstalledItem = ({ plugin }: { plugin: InstalledPlugin }) => {
  const pluginService = useService(PluginService);
  const meta =
    plugin.status === 'error'
      ? `${plugin.manifest.id} · v${plugin.manifest.version} · error: ${plugin.error ?? ''}`
      : `${plugin.manifest.id} · v${plugin.manifest.version} · ${plugin.source} · ${plugin.status}`;
  return (
    <div className={styles.item} data-testid="mobile-plugin-installed">
      <div className={styles.itemHead}>
        <div className={styles.itemName}>{plugin.manifest.name}</div>
        <div className={styles.itemActions}>
          <Switch
            checked={plugin.enabled && plugin.status === 'active'}
            onChange={checked =>
              pluginService.setEnabled(plugin.manifest.id, checked)
            }
          />
          <Button onClick={() => pluginService.uninstall(plugin.manifest.id)}>
            Uninstall
          </Button>
        </div>
      </div>
      <div className={styles.itemMeta}>{meta}</div>
    </div>
  );
};
