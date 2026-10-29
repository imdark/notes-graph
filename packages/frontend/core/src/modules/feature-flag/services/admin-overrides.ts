import { updateAppConfigMutation } from '@notesgraph/graphql';
import { LiveData, OnEvent, Service } from '@notesgraph/infra';

import type { WorkspaceServerService } from '../../cloud';
import { FetchService, GraphQLService, UserFeatureService } from '../../cloud';
import { WorkspaceInitialized } from '../../workspace/events';
import type { FeatureFlagService } from './feature-flag';

/** An admin's setting for a flag: on or off for everyone, or not set. */
export type AdminFlagSetting = boolean | null;

/** `overrides` with `key` set to `setting`, or dropped when it is null. */
export const withOverride = (
  overrides: Record<string, boolean>,
  key: string,
  setting: AdminFlagSetting
): Record<string, boolean> => {
  const next = { ...overrides };
  if (setting === null) delete next[key];
  else next[key] = setting;
  return next;
};

/**
 * The feature flags an admin turned on or off for everyone on this
 * workspace's server (config `flags.featureOverrides`). Read when a workspace
 * opens and applied over each user's own settings; changed from the Feature
 * flags page, which only a server admin may do.
 */
@OnEvent(WorkspaceInitialized, s => s.refresh)
export class FeatureFlagAdminService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly featureFlagService: FeatureFlagService
  ) {
    super();
  }

  /** Null until the server has answered, or for a local workspace. */
  readonly overrides$ = new LiveData<Record<string, boolean> | null>(null);
  readonly error$ = new LiveData<string | null>(null);

  private get server() {
    return this.workspaceServerService.server;
  }

  /** Whether the signed-in user is this server's admin; null while unknown. */
  get isAdmin$(): LiveData<boolean | null | undefined> {
    const server = this.server;
    if (!server) return new LiveData<boolean | null | undefined>(false);
    return server.scope.get(UserFeatureService).userFeature.isAdmin$;
  }

  refresh = async () => {
    const server = this.server;
    if (!server) return;
    try {
      const response = await server.scope
        .get(FetchService)
        .fetch('/api/server/feature-flags');
      const text = await response.text();
      // A server without the endpoint answers with the app's index.html.
      if (!response.ok || text.trimStart().startsWith('<')) return;
      const { overrides } = JSON.parse(text) as {
        overrides?: Record<string, boolean>;
      };
      this.apply(overrides ?? {});
      this.error$.setValue(null);
    } catch (err) {
      this.error$.setValue(err instanceof Error ? err.message : String(err));
    }
  };

  /** Set a flag for everyone, or (null) let users choose again. Admins only. */
  async set(key: string, setting: AdminFlagSetting): Promise<void> {
    const server = this.server;
    if (!server) throw new Error('This workspace is local: it has no server.');
    const next = withOverride(this.overrides$.value ?? {}, key, setting);
    await server.scope.get(GraphQLService).gql({
      query: updateAppConfigMutation,
      variables: {
        updates: [
          // The schema types this JSON scalar as a string map; any JSON goes.
          { module: 'flags', key: 'featureOverrides', value: next as any },
        ],
      },
    });
    this.apply(next);
  }

  private apply(overrides: Record<string, boolean>) {
    this.overrides$.setValue(overrides);
    this.featureFlagService.flags.applyAdminOverrides(overrides);
  }
}
