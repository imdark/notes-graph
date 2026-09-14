import { SaveIcon } from '@blocksuite/icons/rc';
import { Button, usePromptModal } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';
import { useCallback } from 'react';

import * as styles from './save-as-collection-button.css';

interface SaveAsCollectionButtonProps {
  onConfirm: (collectionName: string) => void;
}

export const SaveAsCollectionButton = ({
  onConfirm,
}: SaveAsCollectionButtonProps) => {
  const t = useI18n();
  const { openPromptModal } = usePromptModal();
  const handleClick = useCallback(() => {
    openPromptModal({
      title: t['com.notesgraph.editCollection.saveCollection'](),
      label: t['com.notesgraph.editCollectionName.name'](),
      inputOptions: {
        placeholder: t['com.notesgraph.editCollectionName.name.placeholder'](),
      },
      children: (
        <div className={styles.createTips}>
          {t['com.notesgraph.editCollectionName.createTips']()}
        </div>
      ),
      confirmText: t['com.notesgraph.editCollection.save'](),
      cancelText: t['com.notesgraph.editCollection.button.cancel'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm(name) {
        onConfirm(name);
      },
    });
  }, [openPromptModal, t, onConfirm]);
  return (
    <Button
      onClick={handleClick}
      data-testid="save-as-collection"
      prefix={<SaveIcon />}
      className={styles.button}
    >
      {t['com.notesgraph.editCollection.saveCollection']()}
    </Button>
  );
};
