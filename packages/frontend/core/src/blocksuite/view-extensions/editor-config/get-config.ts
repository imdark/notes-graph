import { ToolbarMoreMenuConfigExtension } from '@blocksuite/notesgraph/components/toolbar';
import { EditorSettingExtension } from '@blocksuite/notesgraph/shared/services';
import type { ExtensionType } from '@blocksuite/store';
import {
  createCustomToolbarExtension,
  createToolbarMoreMenuConfig,
} from '@notesgraph/core/blocksuite/view-extensions/editor-config/toolbar';
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud';
import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import { EditorSettingService } from '@notesgraph/core/modules/editor-setting';
import {
  linkCardEmbeddableEndpoint,
  linkCardImageUrl,
} from '@notesgraph/core/modules/link-card';
import type { FrameworkProvider } from '@notesgraph/infra';

export function getEditorConfigExtension(
  framework: FrameworkProvider
): ExtensionType[] {
  const editorSettingService = framework.get(EditorSettingService);
  const workspaceServerService = framework.get(WorkspaceServerService);
  const baseUrl = workspaceServerService.server?.baseUrl ?? location.origin;

  // Host-aware link-card image resolver: a data URL via the Electron main
  // process on desktop, or the local sidecar URL on web.
  const desktopApi = framework.getOptional(DesktopApiService);
  const resolveLinkCardImage = desktopApi
    ? (url: string, mode: 'card' | 'screenshot') =>
        desktopApi.handler.linkCard.getImage(url, mode)
    : (url: string, mode: 'card' | 'screenshot') =>
        Promise.resolve(linkCardImageUrl(url, mode));

  // Whether a URL can be shown in an iframe (no X-Frame-Options / CSP block).
  // Used to fall back to a screenshot when embedding would just show blank.
  const checkLinkCardEmbeddable = desktopApi
    ? (url: string) => desktopApi.handler.linkCard.isEmbeddable(url)
    : (url: string) =>
        fetch(linkCardEmbeddableEndpoint(url))
          .then(r => r.json())
          .then((d: { embeddable?: boolean }) => d.embeddable !== false)
          .catch(() => true);

  return [
    EditorSettingExtension({
      // eslint-disable-next-line rxjs/finnish
      setting$: editorSettingService.editorSetting.settingSignal,
      set: (k, v) => editorSettingService.editorSetting.set(k, v),
    }),
    ToolbarMoreMenuConfigExtension(createToolbarMoreMenuConfig(framework)),

    createCustomToolbarExtension(
      framework,
      editorSettingService.editorSetting,
      baseUrl,
      resolveLinkCardImage,
      checkLinkCardEmbeddable
    ),
  ].flat();
}
