import { Button } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { appIconMap } from '@notesgraph/core/utils';
import { apis, events } from '@notesgraph/electron-api';
import { useI18n } from '@notesgraph/i18n';
import track from '@notesgraph/track';
import { useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './styles.css';

type Status = {
  id: number;
  status:
    | 'new'
    | 'starting'
    | 'start_failed'
    | 'recording'
    | 'finalizing'
    | 'pending_import'
    | 'importing'
    | 'imported'
    | 'import_failed'
    | 'finalize_failed';
  appName?: string;
  appGroupId?: number;
  icon?: Buffer;
  filepath?: string;
  sampleRate?: number;
  numberOfChannels?: number;
};

export const useRecordingStatus = () => {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    // Get initial status
    apis?.recording
      .getCurrentRecording()
      .then(status => setStatus(status satisfies Status | null))
      .catch(console.error);

    // Subscribe to status changes
    const unsubscribe = events?.recording.onRecordingStatusChanged(status =>
      setStatus(status satisfies Status | null)
    );

    return () => {
      unsubscribe?.();
    };
  }, []);

  return status;
};

const appIcon = appIconMap[BUILD_CONFIG.appBuildType];

export function Recording() {
  const status = useRecordingStatus();
  const trackedNewRecordingIdsRef = useRef<Set<number>>(new Set());

  const t = useI18n();
  const textElement = useMemo(() => {
    if (!status) {
      return null;
    }
    if (status.status === 'new') {
      return t['com.notesgraph.recording.new']();
    } else if (status.status === 'imported') {
      return t['com.notesgraph.recording.success.prompt']();
    } else if (
      status.status === 'import_failed' ||
      status.status === 'start_failed' ||
      status.status === 'finalize_failed'
    ) {
      return t['com.notesgraph.recording.failed.prompt']();
    } else if (
      status.status === 'starting' ||
      status.status === 'recording' ||
      status.status === 'finalizing'
    ) {
      if (status.appName) {
        return t['com.notesgraph.recording.recording']({
          appName: status.appName,
        });
      } else {
        return t['com.notesgraph.recording.recording.unnamed']();
      }
    } else if (
      status.status === 'pending_import' ||
      status.status === 'importing'
    ) {
      return t['com.notesgraph.recording.importing.prompt']();
    }
    return null;
  }, [status, t]);

  const handleDismiss = useAsyncCallback(async () => {
    if (status) {
      await apis?.recording?.dismissRecordingStatus(status.id);
    }
    await apis?.popup?.dismissCurrentRecording();
    track.popup.$.recordingBar.dismissRecording({
      type: 'Meeting record',
      appName: status?.appName || 'System Audio',
    });
  }, [status]);

  const handleStopRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    track.popup.$.recordingBar.finishRecording({
      type: 'Meeting record',
      appName: status.appName || 'System Audio',
    });
    await apis?.recording?.stopRecording(status.id);
  }, [status]);

  useEffect(() => {
    if (!status || status.status !== 'new') return;
    if (trackedNewRecordingIdsRef.current.has(status.id)) return;

    trackedNewRecordingIdsRef.current.add(status.id);
    track.popup.$.recordingBar.toggleRecordingBar({
      type: 'Meeting record',
      appName: status.appName || 'System Audio',
    });
  }, [status]);

  const handleStartRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    track.popup.$.recordingBar.startRecording({
      type: 'Meeting record',
      appName: status.appName || 'System Audio',
    });
    await apis?.recording?.startRecording(status.appGroupId);
  }, [status]);

  const handleOpenFile = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    await apis?.recording?.showSavedRecordings(status.filepath);
  }, [status]);

  const controlsElement = useMemo(() => {
    if (!status) {
      return null;
    }
    if (status.status === 'new') {
      return (
        <>
          <Button variant="plain" onClick={handleDismiss}>
            {t['com.notesgraph.recording.dismiss']()}
          </Button>
          <Button
            onClick={handleStartRecording}
            variant="primary"
            prefix={<div className={styles.recordingIcon} />}
          >
            {t['com.notesgraph.recording.start']()}
          </Button>
        </>
      );
    } else if (status.status === 'recording') {
      return (
        <Button variant="error" onClick={handleStopRecording}>
          {t['com.notesgraph.recording.stop']()}
        </Button>
      );
    } else if (
      status.status === 'starting' ||
      status.status === 'finalizing' ||
      status.status === 'pending_import' ||
      status.status === 'importing'
    ) {
      return (
        <Button
          variant="error"
          onClick={handleDismiss}
          loading={true}
          disabled
        />
      );
    } else if (status.status === 'imported') {
      return (
        <Button variant="primary" onClick={handleDismiss}>
          {t['com.notesgraph.recording.success.button']()}
        </Button>
      );
    } else if (status.status === 'start_failed') {
      return (
        <Button variant="plain" onClick={handleDismiss}>
          {t['com.notesgraph.recording.dismiss']()}
        </Button>
      );
    } else if (
      status.status === 'import_failed' ||
      status.status === 'finalize_failed'
    ) {
      return (
        <>
          <Button variant="plain" onClick={handleDismiss}>
            {t['com.notesgraph.recording.dismiss']()}
          </Button>
          <Button variant="error" onClick={handleOpenFile}>
            {t['com.notesgraph.recording.failed.button']()}
          </Button>
        </>
      );
    }
    return null;
  }, [
    handleDismiss,
    handleOpenFile,
    handleStartRecording,
    handleStopRecording,
    status,
    t,
  ]);

  if (!status) {
    return null;
  }

  return (
    <div className={styles.root}>
      <img className={styles.notesgraphIcon} src={appIcon} alt="NotesGraph" />
      <div className={styles.text}>{textElement}</div>
      <div className={styles.controls}>{controlsElement}</div>
    </div>
  );
}
