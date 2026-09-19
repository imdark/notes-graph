export { InventoryDevices } from './entities/devices';
export { InventoryService } from './services/inventory';
export {
  DEVICE_KINDS,
  DEVICE_STATES,
  type DeviceKind,
  type DeviceState,
  type InventoryDevice,
  InventoryDisabledError,
  type RegisterDeviceInput,
} from './stores/inventory';

import { type Framework } from '@notesgraph/infra';

import { FetchService, ServerScope, WorkspaceServerService } from '../cloud';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { InventoryDevices } from './entities/devices';
import { InventoryService } from './services/inventory';
import { InventoryStore } from './stores/inventory';

export function configureInventoryModule(framework: Framework) {
  // Two statements, not one chain: `.scope(A).scope(B)` nests B inside A, and
  // the workspace scope does not live under the server scope. The store stays
  // server-scoped (it is the server's API) and the entity reaches it through
  // WorkspaceServerService, the way the cloud module's stores are reached.
  framework.scope(ServerScope).store(InventoryStore, [FetchService]);
  framework
    .scope(WorkspaceScope)
    .service(InventoryService)
    .entity(InventoryDevices, [WorkspaceService, WorkspaceServerService]);
}
