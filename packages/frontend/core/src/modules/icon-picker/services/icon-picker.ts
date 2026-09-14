// Import the identifier for internal use
import { type IconPickerService as IIconPickerService } from '@blocksuite/notesgraph-shared/services';
import { IconPicker, uniReactRoot } from '@notesgraph/component';
import { Service } from '@notesgraph/infra';

// Re-export types from BlockSuite shared services
export type {
  IconData,
  IconPickerService as IIconPickerService,
} from '@blocksuite/notesgraph-shared/services';
export { IconPickerServiceIdentifier } from '@blocksuite/notesgraph-shared/services';

export class IconPickerService extends Service implements IIconPickerService {
  // The component-package IconData and the blocksuite-shared IconData are the
  // same shape, but each declares its own (nominal) IconType enum, so TS
  // can't unify them across the boundary — bridge with a cast.
  public readonly iconPickerComponent = uniReactRoot.createUniComponent(
    IconPicker
  ) as unknown as IIconPickerService['iconPickerComponent'];
}
