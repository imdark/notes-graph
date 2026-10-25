import { CaptureView } from '@notesgraph/core/components/capture';
import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';
import { isQuickAskWindow } from '@notesgraph/core/utils/quick-ask';
import { useServiceOptional } from '@notesgraph/infra';
import { useEffect } from 'react';

export const Component = () => {
  const desktopApi = useServiceOptional(DesktopApiService);
  const quickWindow = isQuickAskWindow();

  // Escape puts the capture window away; the note is already saved.
  useEffect(() => {
    if (!quickWindow || !desktopApi) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      desktopApi.handler.ui.hideQuickAsk().catch(console.error);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktopApi, quickWindow]);

  return (
    <>
      <ViewTitle title="Capture" />
      <ViewIcon icon="capture" />
      <ViewBody>
        <CaptureView openNoteAt={quickWindow ? 'new-tab' : 'active'} />
      </ViewBody>
    </>
  );
};
