import {
  catchErrorInto,
  effect,
  Entity,
  exhaustMapWithTrailing,
  fromPromise,
  LiveData,
  onComplete,
  onStart,
  smartRetry,
} from '@notesgraph/infra';
import { catchError, EMPTY, tap } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceService } from '../../workspace';
import {
  type InventoryDevice,
  InventoryDisabledError,
  type RegisterDeviceInput,
  InventoryStore,
} from '../stores/inventory';

/**
 * The workspace's fleet, as the server knows it. Nothing pushes changes — the
 * `wf` CLI writes devices over REST — so the list is revalidated on open and
 * after every local edit rather than kept live.
 */
export class InventoryDevices extends Entity {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  private readonly store =
    this.workspaceServerService.server?.scope.get(InventoryStore);

  readonly devices$ = new LiveData<InventoryDevice[] | undefined>(undefined);
  readonly isLoading$ = new LiveData(false);
  readonly error$ = new LiveData<any | null>(null);

  /**
   * True once the server has told us the plugin is switched off. `undefined`
   * until the first answer, so the panel can hold its peace rather than
   * flash "unavailable" at someone whose server is simply slow.
   */
  readonly disabled$ = new LiveData<boolean | undefined>(undefined);

  /** A local workspace has no server to ask, so there is no inventory. */
  readonly unsupported$ = new LiveData(!this.store);

  readonly revalidate = effect(
    exhaustMapWithTrailing(() => {
      const store = this.store;
      if (!store) {
        return EMPTY;
      }
      return fromPromise(signal =>
        store.listDevices(this.workspaceService.workspace.id, signal)
      ).pipe(
        tap(devices => {
          this.disabled$.setValue(false);
          this.devices$.setValue(devices);
        }),
        // A switched-off plugin is an answer, not a failure: swallow it before
        // smartRetry can spend a backoff sequence re-asking a settled question.
        catchError(err => {
          if (err instanceof InventoryDisabledError) {
            this.disabled$.setValue(true);
            this.devices$.setValue([]);
            return EMPTY;
          }
          throw err;
        }),
        smartRetry(),
        catchErrorInto(this.error$),
        onStart(() => {
          this.error$.setValue(null);
          this.isLoading$.setValue(true);
        }),
        onComplete(() => this.isLoading$.setValue(false))
      );
    })
  );

  async register(input: RegisterDeviceInput) {
    if (!this.store) {
      throw new Error('This workspace has no server to hold an inventory');
    }
    const device = await this.store.registerDevice(
      this.workspaceService.workspace.id,
      input
    );
    this.revalidate();
    return device;
  }

  async remove(key: string) {
    if (!this.store) {
      throw new Error('This workspace has no server to hold an inventory');
    }
    await this.store.removeDevice(this.workspaceService.workspace.id, key);
    this.revalidate();
  }

  override dispose(): void {
    this.revalidate.unsubscribe();
  }
}
