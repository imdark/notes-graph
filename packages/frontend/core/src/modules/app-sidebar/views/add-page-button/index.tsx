import {
  ArrowDownSmallIcon,
  PlusIcon,
  TemplateIcon,
} from '@blocksuite/icons/rc';
import type { DocMode } from '@blocksuite/notesgraph/model';
import { Button, Menu, MenuItem, MenuSub } from '@notesgraph/component';
import { usePageHelper } from '@notesgraph/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorSettingService } from '@notesgraph/core/modules/editor-setting';
import { TemplateDocService } from '@notesgraph/core/modules/template-doc';
import { TemplateListMenuContentScrollable } from '@notesgraph/core/modules/template-doc/view/template-list-menu';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { inferOpenMode } from '@notesgraph/core/utils';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import clsx from 'clsx';
import type React from 'react';
import { createElement, type MouseEvent, useCallback } from 'react';

import * as styles from './index.css';

/**
 * @return a function to create a new doc, will duplicate the template doc if the page template is enabled
 */
const useNewDoc = () => {
  const workspaceService = useService(WorkspaceService);
  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;

  const currentWorkspace = workspaceService.workspace;
  const enablePageTemplate = useLiveData(
    templateDocService.setting.enablePageTemplate$
  );
  const pageTemplateDocId = useLiveData(
    templateDocService.setting.pageTemplateDocId$
  );

  const pageHelper = usePageHelper(currentWorkspace.docCollection);

  const createPage = useAsyncCallback(
    async (e?: MouseEvent, mode?: DocMode) => {
      if (enablePageTemplate && pageTemplateDocId) {
        const docId =
          await docsService.duplicateFromTemplate(pageTemplateDocId);
        workbench.openDoc(docId, { at: inferOpenMode(e) });
      } else {
        pageHelper.createPage(mode, { at: inferOpenMode(e) });
      }
    },
    [docsService, enablePageTemplate, pageHelper, pageTemplateDocId, workbench]
  );

  return createPage;
};

interface AddPageButtonProps {
  className?: string;
  style?: React.CSSProperties;
}

const sideBottom = { side: 'bottom' as const };
export function AddPageButton(props: AddPageButtonProps) {
  const editorSetting = useService(EditorSettingService);
  const newDocDefaultMode = useLiveData(
    editorSetting.editorSetting.settings$.selector(s => s.newDocDefaultMode)
  );

  return newDocDefaultMode === 'ask' ? (
    <AddPageWithAsk {...props} />
  ) : (
    <AddPageWithoutAsk {...props} />
  );
}

function AddPageWithAsk({ className, style }: AddPageButtonProps) {
  const t = useI18n();
  const createDoc = useNewDoc();
  const workbench = useService(WorkbenchService).workbench;
  const docsService = useService(DocsService);
  const creatableModes = useLiveData(
    useService(DocModeRegistryService).creatableModes$
  );

  const createInMode = useCallback(
    (mode: DocMode, e?: MouseEvent) => {
      createDoc(e, mode);
      track.$.navigationPanel.$.createDoc();
      track.$.sidebar.newDoc.quickStart({ with: mode });
    },
    [createDoc]
  );

  const createDocFromTemplate = useAsyncCallback(
    async (templateId: string) => {
      const docId = await docsService.duplicateFromTemplate(templateId);
      workbench.openDoc(docId);
      track.$.sidebar.newDoc.quickStart({ with: 'template' });
    },
    [docsService, workbench]
  );

  return (
    <Menu
      items={
        <>
          {creatableModes.map(modeDescriptor => {
            const handler = (e?: MouseEvent) =>
              createInMode(modeDescriptor.id, e);
            return (
              <MenuItem
                key={modeDescriptor.id}
                prefixIcon={createElement(modeDescriptor.icon)}
                onClick={handler}
                onAuxClick={handler}
              >
                {t.t(modeDescriptor.labelKey)}
              </MenuItem>
            );
          })}
          <MenuSub
            triggerOptions={{
              prefixIcon: <TemplateIcon />,
            }}
            subContentOptions={{
              sideOffset: 16,
              className: styles.templateMenu,
            }}
            items={
              <TemplateListMenuContentScrollable
                onSelect={createDocFromTemplate}
              />
            }
          >
            {t['Template']()}
          </MenuSub>
        </>
      }
    >
      <Button
        tooltip={t['New Page']()}
        tooltipOptions={sideBottom}
        data-testid="sidebar-new-page-with-ask-button"
        className={clsx([styles.labeledRoot, className])}
        style={style}
      >
        <div className={styles.labeledContent}>
          <span className={styles.labeledIcon}>
            <PlusIcon />
          </span>
          {t['com.notesgraph.rootAppSidebar.new-note']()}
          <ArrowDownSmallIcon />
        </div>
      </Button>
    </Menu>
  );
}

function AddPageWithoutAsk({ className, style }: AddPageButtonProps) {
  const createDoc = useNewDoc();

  const onClickNewPage = useCallback(
    (e?: MouseEvent) => {
      createDoc(e);
      track.$.navigationPanel.$.createDoc();
    },
    [createDoc]
  );

  const t = useI18n();

  return (
    <Button
      tooltip={t['New Page']()}
      tooltipOptions={sideBottom}
      data-testid="sidebar-new-page-button"
      style={style}
      className={clsx([styles.labeledRoot, className])}
      onClick={onClickNewPage}
      onAuxClick={onClickNewPage}
    >
      <div className={styles.labeledContent}>
        <span className={styles.labeledIcon}>
          <PlusIcon />
        </span>
        {t['com.notesgraph.rootAppSidebar.new-note']()}
      </div>
    </Button>
  );
}
