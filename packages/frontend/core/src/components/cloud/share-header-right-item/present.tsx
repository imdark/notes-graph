import { PresentationIcon } from '@blocksuite/icons/rc';
import { Button } from '@notesgraph/component/ui/button';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

import * as styles from './styles.css';

export const PresentButton = () => {
  const t = useI18n();
  const editorService = useService(EditorService);
  const isPresent = useLiveData(editorService.editor.isPresenting$);

  return (
    <Button
      prefix={<PresentationIcon />}
      className={styles.presentButton}
      onClick={() => editorService.editor.togglePresentation()}
      disabled={isPresent}
    >
      {t['com.notesgraph.share-page.header.present']()}
    </Button>
  );
};
