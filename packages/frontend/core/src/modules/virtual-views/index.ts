export { VirtualViews } from './entities/virtual-views';
export { VirtualViewsService } from './services/virtual-views';
export type { VirtualItem, VirtualView } from './stores/virtual-views';

import { type Framework } from '@notesgraph/infra';

import { WorkspaceDBService } from '../db';
import { WorkspaceScope } from '../workspace';
import { VirtualViews } from './entities/virtual-views';
import { VirtualViewsService } from './services/virtual-views';
import { VirtualViewsStore } from './stores/virtual-views';

export function configureVirtualViewsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(VirtualViewsService, [VirtualViewsStore])
    .store(VirtualViewsStore, [WorkspaceDBService])
    .entity(VirtualViews, [VirtualViewsStore]);
}
