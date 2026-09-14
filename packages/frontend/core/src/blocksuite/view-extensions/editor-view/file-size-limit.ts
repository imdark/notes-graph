import type { Container } from '@blocksuite/notesgraph/global/di';
import {
  FileSizeLimitProvider,
  type IFileSizeLimitService,
} from '@blocksuite/notesgraph/shared/services';
import { Extension } from '@blocksuite/notesgraph/store';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import type { FrameworkProvider } from '@notesgraph/infra';
import track from '@notesgraph/track';

export function patchFileSizeLimitExtension(framework: FrameworkProvider) {
  const workspaceDialogService = framework.get(WorkspaceDialogService);

  class NotesGraphFileSizeLimitService
    extends Extension
    implements IFileSizeLimitService
  {
    // 2GB
    maxFileSize = 2 * 1024 * 1024 * 1024;

    onOverFileSize() {
      workspaceDialogService.open('setting', {
        activeTab: 'plans',
        scrollAnchor: 'cloudPricingPlan',
      });
      track.$.paywall.storage.viewPlans();
    }

    static override setup(di: Container) {
      di.override(FileSizeLimitProvider, NotesGraphFileSizeLimitService);
    }
  }

  return NotesGraphFileSizeLimitService;
}
