import type { DocRole, PublicDocMode } from '@notesgraph/graphql';
import { Entity, LiveData } from '@notesgraph/infra';
import type {
  DocShareStateSnapshot,
  RealtimeTopicEventOf,
} from '@notesgraph/realtime';

import { RealtimeLiveQuery } from '../../cloud/realtime/live-query';
import type { DocService } from '../../doc';
import type { WorkspaceService } from '../../workspace';
import type { ShareStore } from '../stores/share';

type ShareInfoType = Omit<
  DocShareStateSnapshot,
  'defaultRole' | 'mode' | 'publicRole'
> & {
  defaultRole: DocRole;
  mode: PublicDocMode;
  publicRole: DocRole | null;
};

export class ShareInfo extends Entity {
  info$ = new LiveData<ShareInfoType | undefined | null>(null);
  isShared$ = this.info$.map(info => info?.public);
  sharedMode$ = this.info$.map(info => (info !== null ? info?.mode : null));
  /** Reader (read only) or Commenter (read + comment) when shared, else null */
  publicRole$ = this.info$.map(info => (info?.public ? info.publicRole : null));

  error$ = new LiveData<any>(null);
  isRevalidating$ = new LiveData<boolean>(false);

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly docService: DocService,
    private readonly store: ShareStore
  ) {
    super();
    this.liveQuery.start();
  }

  private readonly liveQuery = new RealtimeLiveQuery<
    ShareInfoType | undefined,
    RealtimeTopicEventOf<'doc.share-state.changed'>
  >({
    request: signal => this.requestShareInfo(signal),
    subscribe: () =>
      this.store.subscribeShareState(
        this.workspaceService.workspace.id,
        this.docService.doc.id
      ),
    applySnapshot: info => {
      this.error$.next(null);
      this.info$.next(info);
    },
    applyEvent: () => 'revalidate',
    onError: error => this.error$.setValue(error),
  });

  revalidate = () => {
    this.liveQuery.revalidate();
  };

  waitForRevalidation(signal?: AbortSignal) {
    this.revalidate();
    return this.isRevalidating$.waitFor(v => v === false, signal);
  }

  async enableShare(mode: PublicDocMode, publicRole?: DocRole) {
    await this.store.enableSharePage(
      this.workspaceService.workspace.id,
      this.docService.doc.id,
      mode,
      publicRole
    );
    await this.waitForRevalidation();
  }

  async changeShare(mode: PublicDocMode, publicRole?: DocRole) {
    await this.enableShare(mode, publicRole);
  }

  async disableShare() {
    await this.store.disableSharePage(
      this.workspaceService.workspace.id,
      this.docService.doc.id
    );
    await this.waitForRevalidation();
  }

  override dispose(): void {
    this.liveQuery.dispose();
  }

  private async requestShareInfo(signal: AbortSignal) {
    this.isRevalidating$.next(true);
    try {
      return await this.store.getShareInfoByDocId(
        this.workspaceService.workspace.id,
        this.docService.doc.id,
        signal
      );
    } finally {
      this.isRevalidating$.next(false);
    }
  }
}
