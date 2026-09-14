import { type DocMode } from '@blocksuite/notesgraph/model';
import type { Workspace } from '@blocksuite/notesgraph/store';
import { toast } from '@notesgraph/component';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { AppSidebarService } from '@notesgraph/core/modules/app-sidebar';
import { DocsService } from '@notesgraph/core/modules/doc';
import {
  EditorSettingService,
  resolveNewDocTitle,
} from '@notesgraph/core/modules/editor-setting';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { getNotesGraphWorkspaceSchema } from '@notesgraph/core/modules/workspace';
import { LiveData, useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

export const usePageHelper = (docCollection: Workspace) => {
  const {
    docsService,
    workbenchService,
    appSidebarService,
    editorSettingService,
  } = useServices({
    DocsService,
    WorkbenchService,
    AppSidebarService,
    EditorSettingService,
  });
  const workbench = workbenchService.workbench;
  const docRecordList = docsService.list;
  const appSidebar = appSidebarService.sidebar;
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const allDocTitles = useLiveData(
    useMemo(() => LiveData.from(docsService.allDocTitle$(), []), [docsService])
  );

  const createBlankDoc = useCallback(() => {
    const title = resolveNewDocTitle({
      autoTitleEnabled: settings.autoTitleNewDocWithCurrentDate,
      existingTitles: allDocTitles.map(doc => doc.title).filter(Boolean),
      format: settings.newDocDateTitleFormat,
    });

    return docsService.createDoc(title ? { title } : undefined);
  }, [
    allDocTitles,
    docsService,
    settings.autoTitleNewDocWithCurrentDate,
    settings.newDocDateTitleFormat,
  ]);

  const createPageAndOpen = useCallback(
    (
      mode?: DocMode,
      options: {
        at?: 'new-tab' | 'tail' | 'active';
        show?: boolean;
      } = {
        at: 'active',
        show: true,
      }
    ) => {
      appSidebar.setHovering(false);
      const page = createBlankDoc();

      if (mode) {
        docRecordList.doc$(page.id).value?.setPrimaryMode(mode);
      }

      if (options.show !== false) {
        workbench.openDoc(page.id, {
          at: options.at,
          show: options.show,
        });
      }
      return page;
    },
    [appSidebar, createBlankDoc, docRecordList, workbench]
  );

  const createEdgelessAndOpen = useCallback(
    (
      options: { at?: 'new-tab' | 'tail' | 'active'; show?: boolean } = {
        at: 'active',
        show: true,
      }
    ) => {
      return createPageAndOpen('edgeless', options);
    },
    [createPageAndOpen]
  );

  const importFileAndOpen = useMemo(
    () => async () => {
      const { showImportModal } =
        await import('@blocksuite/notesgraph/widgets/linked-doc');
      const { promise, resolve, reject } =
        Promise.withResolvers<
          Parameters<
            NonNullable<Parameters<typeof showImportModal>[0]['onSuccess']>
          >[1]
        >();
      const onSuccess = (
        pageIds: string[],
        options: { isWorkspaceFile: boolean; importedCount: number }
      ) => {
        resolve(options);
        toast(
          `Successfully imported ${options.importedCount} Page${
            options.importedCount > 1 ? 's' : ''
          }.`
        );
        if (options.isWorkspaceFile) {
          workbench.openAll();
          return;
        }

        if (pageIds.length === 0) {
          return;
        }
        const pageId = pageIds[0];
        workbench.openDoc(pageId);
      };
      showImportModal({
        collection: docCollection,
        schema: getNotesGraphWorkspaceSchema(),
        extensions: getStoreManager().config.init().value.get('store'),
        onSuccess,
        onFail: message => {
          reject(new Error(message));
        },
      });
      return await promise;
    },
    [docCollection, workbench]
  );

  return useMemo(() => {
    return {
      createPage: (
        mode?: DocMode,
        options?: {
          at?: 'new-tab' | 'tail' | 'active';
          show?: boolean;
        }
      ) => createPageAndOpen(mode, options),
      createEdgeless: createEdgelessAndOpen,
      importFile: importFileAndOpen,
    };
  }, [createEdgelessAndOpen, createPageAndOpen, importFileAndOpen]);
};
