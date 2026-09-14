import { EdgelessIcon, ImportIcon, PageIcon } from '@blocksuite/icons/rc';
import { DropdownButton, Menu } from '@notesgraph/component';
import { BlockCard } from '@notesgraph/component/card/block-card';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import type { MouseEvent, PropsWithChildren } from 'react';
import { useCallback, useState } from 'react';

import * as styles from './new-page-button.css';

type NewPageButtonProps = {
  createNewDoc: (e?: MouseEvent) => void;
  createNewPage: (e?: MouseEvent) => void;
  createNewEdgeless: (e?: MouseEvent) => void;
  importFile?: () => void;
  size?: 'small' | 'default';
};

export const CreateNewPagePopup = ({
  createNewPage,
  createNewEdgeless,
  importFile,
}: NewPageButtonProps) => {
  const t = useI18n();
  // Only offer "New Edgeless" when the edgeless plugin is installed and enabled
  // (it registers the 'edgeless' mode in DocModeRegistryService).
  const creatableModes = useLiveData(
    useService(DocModeRegistryService).creatableModes$
  );
  const edgelessAvailable = creatableModes.some(mode => mode.id === 'edgeless');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
      }}
    >
      <BlockCard
        title={t['com.notesgraph.new.page-mode']()}
        desc={t['com.notesgraph.write_with_a_blank_page']()}
        right={<PageIcon width={20} height={20} />}
        onClick={createNewPage}
        onAuxClick={createNewPage}
        data-testid="new-page-button-in-all-page"
      />
      {edgelessAvailable ? (
        <BlockCard
          title={t['com.notesgraph.new_edgeless']()}
          desc={t['com.notesgraph.draw_with_a_blank_whiteboard']()}
          right={<EdgelessIcon width={20} height={20} />}
          onClick={createNewEdgeless}
          onAuxClick={createNewEdgeless}
          data-testid="new-edgeless-button-in-all-page"
        />
      ) : null}
      {importFile ? (
        <BlockCard
          title={t['com.notesgraph.new_import']()}
          desc={t['com.notesgraph.import_file']()}
          right={<ImportIcon width={20} height={20} />}
          onClick={importFile}
          data-testid="import-button-in-all-page"
        />
      ) : null}
      {/* TODO Import */}
    </div>
  );
};

export const NewPageButton = ({
  createNewDoc,
  createNewPage,
  createNewEdgeless,
  importFile,
  size,
  children,
}: PropsWithChildren<NewPageButtonProps>) => {
  const [open, setOpen] = useState(false);

  const handleCreateNewDoc: NewPageButtonProps['createNewDoc'] = useCallback(
    e => {
      createNewDoc(e);
      setOpen(false);
      track.allDocs.header.actions.createDoc();
    },
    [createNewDoc]
  );

  const handleCreateNewPage: NewPageButtonProps['createNewPage'] = useCallback(
    e => {
      createNewPage(e);
      setOpen(false);
      track.allDocs.header.actions.createDoc({ mode: 'page' });
    },
    [createNewPage]
  );

  const handleCreateNewEdgeless: NewPageButtonProps['createNewEdgeless'] =
    useCallback(
      e => {
        createNewEdgeless(e);
        setOpen(false);
        track.allDocs.header.actions.createDoc({
          mode: 'edgeless',
        });
      },
      [createNewEdgeless]
    );

  const handleImportFile = useCallback(() => {
    importFile?.();
    setOpen(false);
  }, [importFile]);

  return (
    <Menu
      items={
        <CreateNewPagePopup
          createNewDoc={handleCreateNewDoc}
          createNewPage={handleCreateNewPage}
          createNewEdgeless={handleCreateNewEdgeless}
          importFile={importFile ? handleImportFile : undefined}
        />
      }
      rootOptions={{
        open,
      }}
      contentOptions={{
        className: styles.menuContent,
        align: 'end',
        hideWhenDetached: true,
        onInteractOutside: useCallback(() => {
          setOpen(false);
        }, []),
      }}
    >
      <DropdownButton
        size={size}
        onClick={handleCreateNewDoc}
        onAuxClick={handleCreateNewPage}
        onClickDropDown={useCallback(() => setOpen(open => !open), [])}
        className={styles.button}
      >
        {children}
      </DropdownButton>
    </Menu>
  );
};
