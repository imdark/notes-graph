import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import type {
  ConfirmModalProps,
  ElementOrFactory,
} from '@notesgraph/component';
import {
  NotesGraphPageReference,
  NotesGraphSharedPageReference,
} from '@notesgraph/core/components/notesgraph/reference-link';
import { DocService, DocsService } from '@notesgraph/core/modules/doc';
import { EditorService } from '@notesgraph/core/modules/editor';
import { toDocSearchParams } from '@notesgraph/core/modules/navigation';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { FrameworkProvider } from '@notesgraph/infra';
import type { TemplateResult } from 'lit';
import { z } from 'zod';

import { patchForAudioEmbedView } from './audio/audio-view';
import { buildDocDisplayMetaExtension } from './display-meta';
import { patchDocModeService } from './doc-mode-service';
import { patchDocUrlExtensions } from './doc-url';
import { patchFileSizeLimitExtension } from './file-size-limit';
import { patchNotificationService } from './notification-service';
import { patchOpenDocExtension } from './open-doc';
import { patchQuickSearchService } from './quick-search-service';
import {
  patchReferenceRenderer,
  type ReferenceReactRenderer,
} from './reference-renderer';
import { patchBlockTaskIndexService } from './block-task-index-service';
import { patchProjectsService } from './projects-service';
import { patchSideBarService } from './side-bar-service';
import { patchUppyUploadService } from './uppy-upload-service';

const optionsSchema = z.object({
  // services
  framework: z.instanceof(FrameworkProvider),

  // react renderer
  reactToLit: z
    .function()
    .args(z.custom<ElementOrFactory>(), z.boolean().optional())
    .returns(z.custom<TemplateResult>()),
  confirmModal: z.object({
    openConfirmModal: z
      .function()
      .args(z.custom<ConfirmModalProps>().optional(), z.any().optional()),
    closeConfirmModal: z.function(),
  }),

  scope: z.enum(['doc', 'workspace']).optional(),
});

export type NotesGraphEditorViewOptions = z.infer<typeof optionsSchema>;

export class NotesGraphEditorViewExtension extends ViewExtensionProvider<NotesGraphEditorViewOptions> {
  override name = 'notesgraph-editor-view';

  override schema = optionsSchema;

  private readonly _getCustomReferenceRenderer = (
    framework: FrameworkProvider
  ): ReferenceReactRenderer => {
    const workspaceService = framework.get(WorkspaceService);
    return function customReference(reference) {
      const data = reference.delta.attributes?.reference;
      if (!data) return <span />;

      const pageId = data.pageId;
      if (!pageId) return <span />;

      // title alias
      const title = data.title;
      const params = toDocSearchParams(data.params);

      if (workspaceService.workspace.openOptions.isSharedMode) {
        return (
          <NotesGraphSharedPageReference
            docCollection={workspaceService.workspace.docCollection}
            pageId={pageId}
            params={params}
            title={title}
          />
        );
      }

      return (
        <NotesGraphPageReference
          pageId={pageId}
          params={params}
          title={title}
        />
      );
    };
  };

  override setup(
    context: ViewExtensionContext,
    options?: NotesGraphEditorViewOptions
  ) {
    super.setup(context, options);
    if (!options) {
      return;
    }
    const { framework, reactToLit, confirmModal, scope = 'doc' } = options;

    const referenceRenderer = this._getCustomReferenceRenderer(framework);

    context
      .register([
        patchReferenceRenderer(reactToLit, referenceRenderer),
        patchNotificationService(confirmModal),
        patchOpenDocExtension(),
        patchSideBarService(framework),
        patchBlockTaskIndexService(framework),
        patchProjectsService(framework),
        patchFileSizeLimitExtension(framework),
        buildDocDisplayMetaExtension(framework),
        patchForAudioEmbedView(reactToLit),
      ])
      .register(patchDocUrlExtensions(framework))
      .register(patchQuickSearchService(framework))
      .register(patchUppyUploadService(framework));

    if (scope === 'doc') {
      const docService = framework.get(DocService);
      const docsService = framework.get(DocsService);
      const editorService = framework.get(EditorService);
      context.register([
        patchDocModeService(docService, docsService, editorService),
      ]);
    }
  }
}
