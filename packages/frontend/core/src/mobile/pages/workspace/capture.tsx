import { useThemeColorV2 } from '@notesgraph/component';
import { CaptureView } from '@notesgraph/core/components/capture';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';

import { PageHeader } from '../../components';
import { Page } from '../../components/page';
import { VirtualKeyboardService } from '../../modules/virtual-keyboard';
import * as styles from './capture.css';

/**
 * Where the "NotesGraph Capture" launcher icon lands: listening straight
 * away, since the launcher is for getting an idea down by voice.
 */
export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  const workbench = useService(WorkbenchService).workbench;
  const keyboardVisible = useLiveData(
    useService(VirtualKeyboardService).visible$
  );

  return (
    <Page
      // The tabs are only made invisible while the keyboard is up; drop them
      // so the space they keep goes to the text box.
      tab={!keyboardVisible}
      header={
        // Opened from the launcher there is no page to go back to.
        <PageHeader back backAction={() => workbench.open('/home')}>
          Capture
        </PageHeader>
      }
    >
      <div className={styles.body}>
        <CaptureView autoListen compact={keyboardVisible} />
      </div>
    </Page>
  );
};
