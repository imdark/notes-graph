import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';

import { Modal } from '@notesgraph/component';
import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import Dashboard from '@uppy/react/dashboard';
import { useTheme } from 'next-themes';
import { useEffect, useMemo } from 'react';

import { createNotesGraphUppy, resolveUppyFiles } from '../../../modules/uppy-upload';

export const UppyUploadDialog = ({
  serverBaseUrl,
  companionUrl,
  accept,
  multiple,
  close,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['uppy-upload']>) => {
  const { resolvedTheme } = useTheme();

  const uppy = useMemo(
    () =>
      createNotesGraphUppy({ serverBaseUrl, companionUrl, accept, multiple }),
    [serverBaseUrl, companionUrl, accept, multiple]
  );

  useEffect(() => {
    return () => {
      uppy.destroy();
    };
  }, [uppy]);

  useEffect(() => {
    const handleComplete: Parameters<typeof uppy.on<'complete'>>[1] = result => {
      resolveUppyFiles(serverBaseUrl, result.successful ?? [])
        .then(files => close(files))
        .catch(() => close([]));
    };
    uppy.on('complete', handleComplete);
    return () => {
      uppy.off('complete', handleComplete);
    };
  }, [uppy, serverBaseUrl, close]);

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) close([]);
      }}
      width={640}
      contentOptions={{
        style: { padding: 0, overflow: 'hidden' },
      }}
    >
      <Dashboard
        uppy={uppy}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        proudlyDisplayPoweredByUppy={false}
        height={400}
        width="100%"
      />
    </Modal>
  );
};
