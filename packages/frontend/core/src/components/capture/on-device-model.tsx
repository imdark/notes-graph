import { Button } from '@notesgraph/component';
import {
  type OnDeviceModelStatus,
  VoiceTasksService,
} from '@notesgraph/core/modules/voice-tasks';
import { useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './capture.css';

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

type View =
  | { kind: 'hidden' }
  | { kind: 'offer'; total: number }
  | { kind: 'downloading'; downloaded: number; total: number }
  | { kind: 'failed'; total: number };

const viewFor = (status: OnDeviceModelStatus): View =>
  status.state === 'ready'
    ? { kind: 'hidden' }
    : status.state === 'downloading'
      ? { kind: 'downloading', ...status }
      : { kind: 'offer', total: status.total };

/**
 * The offer to download the on-device speech model, where the platform has
 * one and it speaks the user's language. Gone once the model is in place:
 * from then on capture listens with it.
 */
export const OnDeviceModelOffer = () => {
  const voice = useService(VoiceTasksService);
  const model = voice.onDeviceModel;
  const usable = !!model && model.supportsLanguage(voice.lang);
  const [view, setView] = useState<View>({ kind: 'hidden' });

  const download = useCallback(
    (total: number) => {
      if (!model) return;
      setView({ kind: 'downloading', downloaded: 0, total });
      model
        .download(progress => setView({ kind: 'downloading', ...progress }))
        .then(() => setView({ kind: 'hidden' }))
        .catch(err => {
          console.error('capture: speech model download', err);
          setView({ kind: 'failed', total });
        });
    },
    [model]
  );

  useEffect(() => {
    if (!model || !usable) return;
    let live = true;
    model
      .status()
      .then(status => {
        if (!live) return;
        // A download already going (from an earlier capture): joining it
        // brings its progress here too.
        if (status.state === 'downloading') download(status.total);
        else setView(viewFor(status));
      })
      .catch(err => console.error('capture: speech model status', err));
    return () => {
      live = false;
    };
  }, [download, model, usable]);

  if (!usable || view.kind === 'hidden') return null;

  if (view.kind === 'downloading') {
    const percent = view.total
      ? Math.floor((view.downloaded / view.total) * 100)
      : 0;
    return (
      <div className={styles.model} data-testid="capture-model">
        <span className={styles.modelText}>
          Downloading the speech model: {percent}% of {megabytes(view.total)}.
          You can keep capturing meanwhile.
        </span>
        <progress
          className={styles.modelProgress}
          value={view.downloaded}
          max={view.total || 1}
          aria-label="Speech model download"
        />
      </div>
    );
  }

  return (
    <div className={styles.model} data-testid="capture-model">
      <span
        className={styles.modelText}
        role={view.kind === 'failed' ? 'alert' : undefined}
      >
        {view.kind === 'failed'
          ? 'The download stopped. It picks up where it left off when you try again.'
          : `Hear you better: a speech model that runs on this phone, ignores background noise and works offline (English, ${megabytes(view.total)}, best on Wi-Fi).`}
      </span>
      <Button
        onClick={() => download(view.total)}
        data-testid="capture-model-download"
      >
        {view.kind === 'failed' ? 'Try again' : 'Download model'}
      </Button>
    </div>
  );
};
