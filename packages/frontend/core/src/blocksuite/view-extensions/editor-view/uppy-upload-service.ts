import { UppyUploadExtension } from '@blocksuite/notesgraph/shared/services';
import { ServerService } from '@notesgraph/core/modules/cloud';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import type { FrameworkProvider } from '@notesgraph/infra';

/**
 * Bridges BlockSuite's `UppyUploadProvider` (consumed deep inside block
 * code, e.g. attachment/image slash-menu configs) to the app's real Uppy
 * upload dialog (`GlobalDialogService.open('uppy-upload', ...)`). Resolves
 * to an empty file list when this editor has no associated server (fully
 * local workspaces), since there's nothing for Companion to talk to.
 */
export function patchUppyUploadService(framework: FrameworkProvider) {
  const getCompanionUrl = () =>
    framework.getOptional(ServerService)?.server.config$.value?.companionUrl;

  return UppyUploadExtension({
    isAvailable: () => !!getCompanionUrl(),
    async openUppyUpload(options) {
      const serverService = framework.getOptional(ServerService);
      if (!serverService) {
        return [];
      }
      const globalDialogService = framework.get(GlobalDialogService);
      return new Promise<File[]>(resolve => {
        globalDialogService.open(
          'uppy-upload',
          {
            serverBaseUrl: serverService.server.baseUrl,
            companionUrl: getCompanionUrl(),
            accept: options?.accept,
            multiple: options?.multiple,
          },
          files => resolve(files ?? [])
        );
      });
    },
  });
}
