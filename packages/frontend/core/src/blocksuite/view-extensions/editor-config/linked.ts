import type { LinkedWidgetConfig } from '@blocksuite/notesgraph/widgets/linked-doc';
import { AtMenuConfigService } from '@notesgraph/core/modules/at-menu-config/services';
import { type FrameworkProvider } from '@notesgraph/infra';

export function createLinkedWidgetConfig(
  framework: FrameworkProvider
): Partial<LinkedWidgetConfig> | undefined {
  const service = framework.getOptional(AtMenuConfigService);
  if (!service) return;
  return service.getConfig();
}
