import { Modal, Scrollable } from '@notesgraph/component';
import { BlocksuiteHeaderTitle } from '@notesgraph/core/blocksuite/block-suite-header/title';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { type Doc, DocsService } from '@notesgraph/core/modules/doc';
import { FrameworkScope, useService } from '@notesgraph/infra';
import { useEffect, useState } from 'react';

import { InfoTable } from './info-modal';
import * as styles from './styles.css';

export const DocInfoDialog = ({
  close,
  docId,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['doc-info']>) => {
  const docsService = useService(DocsService);

  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    if (!docId) return;
    const docRef = docsService.open(docId);
    setDoc(docRef.doc);
    return () => {
      docRef.release();
      setDoc(null);
    };
  }, [docId, docsService]);

  if (!doc || !docId) return null;

  return (
    <FrameworkScope scope={doc.scope}>
      <Modal
        contentOptions={{
          className: styles.container,
        }}
        open
        onOpenChange={() => close()}
        withoutCloseButton
      >
        <Scrollable.Root>
          <Scrollable.Viewport
            className={styles.viewport}
            data-testid="info-modal"
          >
            <div
              className={styles.titleContainer}
              data-testid="info-modal-title"
            >
              <BlocksuiteHeaderTitle className={styles.titleStyle} />
            </div>
            <InfoTable docId={docId} onClose={() => close()} />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar className={styles.scrollBar} />
        </Scrollable.Root>
      </Modal>
    </FrameworkScope>
  );
};
