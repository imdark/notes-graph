import { useExportPage } from '@notesgraph/core/components/hooks/notesgraph/use-export-page';
import {
  ExportMenuItems,
  PrintMenuItems,
} from '@notesgraph/core/components/page-list';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

import * as styles from './index.css';

export const ShareExport = () => {
  const t = useI18n();
  const editor = useService(EditorService).editor;
  const exportHandler = useExportPage();
  const currentMode = useLiveData(editor.mode$);

  return (
    <div className={styles.exportContainerStyle}>
      <div className={styles.descriptionStyle}>
        {t['com.notesgraph.share-menu.ShareViaExportDescription']()}
      </div>
      <div className={styles.exportContainerStyle}>
        <ExportMenuItems
          exportHandler={exportHandler}
          className={styles.exportItemStyle}
          pageMode={currentMode}
        />
      </div>
      {currentMode === 'page' && (
        <>
          <div className={styles.descriptionStyle}>
            {t['com.notesgraph.share-menu.ShareViaPrintDescription']()}
          </div>
          <div>
            <PrintMenuItems
              exportHandler={exportHandler}
              className={styles.exportItemStyle}
            />
          </div>
        </>
      )}
    </div>
  );
};
