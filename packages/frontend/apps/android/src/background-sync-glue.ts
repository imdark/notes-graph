import {
  BACKGROUND_SYNC_ENABLED_KEY,
  buildSyncManifests,
  DEFAULT_BACKGROUND_SYNC_ENABLED,
} from '@notesgraph/core/modules/background-sync';
import { ServersService } from '@notesgraph/core/modules/cloud';
import { GlobalStateService } from '@notesgraph/core/modules/storage';
import { WorkspacesService } from '@notesgraph/core/modules/workspace';
import { type FrameworkProvider, LiveData } from '@notesgraph/infra';
import { debounceTime } from 'rxjs';

import { NbStore } from './plugins/nbstore';

/**
 * Keep the native background-sync manifest in step with the app. Whenever the
 * "background sync" setting, the workspace list, or the signed-in servers
 * change, rebuild the manifest and hand it to the native worker (or cancel it
 * when the setting is off / there's nothing to sync). The token is NOT sent —
 * the native worker reads the fresh one from the keystore itself.
 *
 * DRAFT: unverified against a device build. Runs once at bootstrap.
 */
export function setupBackgroundSyncManifest(framework: FrameworkProvider) {
  const globalState = framework.get(GlobalStateService).globalState;
  const workspacesService = framework.get(WorkspacesService);
  const serversService = framework.get(ServersService);

  const enabled$ = LiveData.from(
    globalState.watch<boolean>(BACKGROUND_SYNC_ENABLED_KEY),
    undefined
  ).map(value => value ?? DEFAULT_BACKGROUND_SYNC_ENABLED);

  const state$ = LiveData.computed(get => ({
    enabled: get(enabled$),
    workspaces: get(workspacesService.list.workspaces$),
    serversWithAccount: get(serversService.serversWithAccount$),
  }));

  const subscription = state$
    .pipe(debounceTime(1000))
    .subscribe(({ enabled, workspaces, serversWithAccount }) => {
      void (async () => {
        try {
          if (!enabled) {
            await NbStore.cancelBackgroundSync();
            return;
          }
          const servers = serversWithAccount.map(({ server, account }) => ({
            id: server.id,
            baseUrl: server.baseUrl,
            signedIn: !!account,
          }));
          const manifests = buildSyncManifests(
            workspaces.map(workspace => ({
              id: workspace.id,
              flavour: workspace.flavour,
            })),
            servers,
            BUILD_CONFIG.appVersion
          );
          if (manifests.length === 0) {
            await NbStore.cancelBackgroundSync();
            return;
          }
          // The Android worker consumes a single manifest today — use the
          // primary (first) cloud server. Multi-server = loop these in the
          // worker instead.
          await NbStore.scheduleBackgroundSync({ manifest: manifests[0] });
        } catch (error) {
          console.error('[background-sync] failed to update manifest', error);
        }
      })();
    });

  return () => subscription.unsubscribe();
}
