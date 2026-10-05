import { CloseIcon, MicrophoneIcon } from '@blocksuite/icons/rc';
import { Button, IconButton, Modal, toast } from '@notesgraph/component';
import { EditorService } from '@notesgraph/core/modules/editor';
import {
  appendDictation,
  insertTasks,
  splitDictatedTasks,
  type SpeechToTextError,
  type SpeechToTextSession,
  VoiceTasksService,
} from '@notesgraph/core/modules/voice-tasks';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './sheet.css';

/**
 * Dictate a batch of tasks: saying "next task" starts a new one (pausing
 * doesn't), the transcript stays editable for fixing what the recognizer
 * misheard, and "Add" writes them all as to-do items where the caret was.
 *
 * Mounted once per open doc; opened through VoiceTasksService from the
 * keyboard toolbar's mic or the page menu.
 */
export const VoiceTasksSheet = () => {
  const t = useI18n();
  const voiceTasks = useService(VoiceTasksService);
  const editor = useService(EditorService).editor;
  const request = useLiveData(voiceTasks.request$);
  const open = !!request && request.docId === editor.doc.id;

  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechToTextError | null>(null);
  const sessionRef = useRef<SpeechToTextSession | null>(null);
  // Bumped per session, so a stopped session's late callbacks (the last
  // utterance arrives after stop) can't touch the sheet once it's moved on.
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setListening(false);
    session?.stop().catch(console.error);
  }, []);

  const start = useCallback(() => {
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    setError(null);
    setListening(true);
    voiceTasks
      .listen({
        onPartial: partial => {
          if (current()) setPartial(partial);
        },
        onSegment: segment => {
          if (!current()) return;
          setPartial('');
          setText(prev => appendDictation(prev, segment));
        },
        onEnd: endError => {
          if (!current()) return;
          sessionRef.current = null;
          setListening(false);
          setPartial('');
          if (endError) setError(endError);
        },
      })
      .then(session => {
        if (current()) sessionRef.current = session;
        else session.stop().catch(console.error);
      })
      .catch(err => {
        console.error(err);
        if (!current()) return;
        setListening(false);
        setError('failed');
      });
  }, [voiceTasks]);

  // Opening the sheet is the request to listen; closing it ends listening.
  useEffect(() => {
    if (!open) return;
    setText('');
    setPartial('');
    start();
    return () => {
      generationRef.current++;
      stop();
    };
  }, [open, start, stop]);

  // What's still being said counts too: tapping Add mid-sentence shouldn't
  // drop the sentence.
  const tasks = useMemo(
    () => splitDictatedTasks(appendDictation(text, partial)),
    [text, partial]
  );

  const close = useCallback(() => {
    voiceTasks.close();
  }, [voiceTasks]);

  const handleAdd = useCallback(() => {
    stop();
    const ids = insertTasks(
      editor.doc.blockSuiteDoc,
      tasks,
      request?.anchorBlockId ?? null
    );
    voiceTasks.close();
    if (ids.length > 0) {
      toast(
        t.t('com.notesgraph.mobile.voice-tasks.added', { count: ids.length })
      );
    }
  }, [editor, request, stop, t, tasks, voiceTasks]);

  const errorMessage =
    error === 'permission-denied'
      ? t['com.notesgraph.mobile.voice-tasks.error.permission']()
      : error === 'unavailable'
        ? t['com.notesgraph.mobile.voice-tasks.error.unavailable']()
        : error
          ? t['com.notesgraph.mobile.voice-tasks.error.failed']()
          : null;

  return (
    <Modal
      width="100%"
      open={open}
      onOpenChange={value => !value && close()}
      withoutCloseButton
      contentOptions={{
        style: { minHeight: 0, padding: '12px 0', borderRadius: 22 },
      }}
    >
      <div className={styles.header}>
        <span className={styles.title}>
          {t['com.notesgraph.mobile.voice-tasks.title']()}
        </span>
        <IconButton size="24" icon={<CloseIcon />} onClick={close} />
      </div>
      <div className={styles.body}>
        {errorMessage ? (
          <div className={styles.error}>{errorMessage}</div>
        ) : (
          <div className={styles.hint}>
            {t['com.notesgraph.mobile.voice-tasks.hint']()}
          </div>
        )}
        <textarea
          className={styles.textarea}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t['com.notesgraph.mobile.voice-tasks.placeholder']()}
          data-testid="voice-tasks-transcript"
        />
        <div className={styles.partial}>{partial}</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.mic}
            data-listening={listening}
            aria-label={
              listening
                ? t['com.notesgraph.mobile.voice-tasks.stop']()
                : t['com.notesgraph.mobile.voice-tasks.listen']()
            }
            onClick={listening ? stop : start}
            data-testid="voice-tasks-mic"
          >
            <MicrophoneIcon />
          </button>
          <Button
            className={styles.add}
            variant="primary"
            size="extraLarge"
            disabled={tasks.length === 0}
            onClick={handleAdd}
            data-testid="voice-tasks-add"
          >
            {t.t('com.notesgraph.mobile.voice-tasks.add', {
              count: tasks.length,
            })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
