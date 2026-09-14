import { NativeClipboardExtension } from '@blocksuite/notesgraph/shared/services';
import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import type { FrameworkProvider } from '@notesgraph/infra';

export function patchForClipboardInElectron(framework: FrameworkProvider) {
  const desktopApi = framework.get(DesktopApiService);
  return NativeClipboardExtension({
    copyAsPNG: desktopApi.handler.clipboard.copyAsPNG,
  });
}
