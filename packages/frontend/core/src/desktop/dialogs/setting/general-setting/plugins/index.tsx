import { Button, Input, notify, Switch } from '@notesgraph/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import {
  type MarketplaceEntry,
  PluginMarketplaceService,
  PluginService,
} from '@notesgraph/core/modules/plugin';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

export const PluginsSettings = () => {
  const pluginService = useService(PluginService);
  const marketplaceService = useService(PluginMarketplaceService);
  const plugins = useLiveData(pluginService.plugins$);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<MarketplaceEntry[] | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const installed = new Set(plugins.map(p => p.manifest.id));

  const refreshMarketplace = useCallback(() => {
    marketplaceService
      .listAvailable()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [marketplaceService]);

  useEffect(() => {
    refreshMarketplace();
  }, [refreshMarketplace]);

  const loadDev = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    pluginService
      .loadDevPlugin(trimmed)
      .then(() => {
        setUrl('');
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        notify.error({
          title: 'Failed to load plugin',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [pluginService, url]);

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
    <>
      <SettingHeader
        title="Plugins"
        subtitle="Browse the marketplace, load development plugins, and manage installed ones."
      />

      <SettingWrapper title="Marketplace">
        {available === null ? (
          <SettingRow name="Loading…" desc="Fetching available plugins." />
        ) : available.length === 0 ? (
          <SettingRow
            name="No plugins available"
            desc="The marketplace is empty or unreachable."
          />
        ) : (
          available.map(entry => (
            <SettingRow
              key={entry.id}
              name={entry.name}
              desc={`${entry.id} · v${entry.version}${entry.description ? ` · ${entry.description}` : ''}`}
            >
              <Button
                variant="primary"
                disabled={installed.has(entry.id)}
                loading={installingId === entry.id}
                onClick={() => install(entry)}
              >
                {installed.has(entry.id) ? 'Installed' : 'Install'}
              </Button>
            </SettingRow>
          ))
        )}
      </SettingWrapper>

      <SettingWrapper title="Development">
        <SettingRow
          name="Load a dev plugin"
          desc="Point at a dev server / folder that serves manifest.json (with CORS)."
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              value={url}
              onChange={setUrl}
              onEnter={loadDev}
              placeholder="http://localhost:5999"
            />
            <Button variant="primary" loading={loading} onClick={loadDev}>
              Load
            </Button>
          </div>
        </SettingRow>
      </SettingWrapper>

      <SettingWrapper title="Installed">
        {plugins.length === 0 ? (
          <SettingRow
            name="No plugins installed"
            desc="Install from the marketplace or load a dev plugin above."
          />
        ) : (
          plugins.map(plugin => (
            <SettingRow
              key={plugin.manifest.id}
              name={plugin.manifest.name}
              desc={
                plugin.status === 'error'
                  ? `${plugin.manifest.id} · v${plugin.manifest.version} · error: ${plugin.error ?? ''}`
                  : `${plugin.manifest.id} · v${plugin.manifest.version} · ${plugin.source} · ${plugin.status}`
              }
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Switch
                  checked={plugin.enabled && plugin.status === 'active'}
                  onChange={checked =>
                    pluginService.setEnabled(plugin.manifest.id, checked)
                  }
                />
                <Button
                  onClick={() => pluginService.uninstall(plugin.manifest.id)}
                >
                  Uninstall
                </Button>
              </div>
            </SettingRow>
          ))
        )}
      </SettingWrapper>
    </>
  );
};
