import { Service } from '@notesgraph/infra';

import { InventoryDevices } from '../entities/devices';

export class InventoryService extends Service {
  devices = this.framework.createEntity(InventoryDevices);
}
