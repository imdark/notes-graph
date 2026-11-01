import { MicrophoneIcon } from '@blocksuite/icons/rc';
import type { Store } from '@blocksuite/notesgraph/store';
import { Button } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import {
  appendDictation,
  type SpeechToTextError,
  type SpeechToTextSession,
  VoiceTasksService,
  writeCapture,
} from '@notesgraph/core/modules/voice-tasks';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './capture.css';

/** How long typing has to pause before the note is rewritten. */
const SAVE_DELAY_MS = 400;

const errorMessages: Record<SpeechToTextError, string> = {
  'permission-denied': 'Allow microphone access to capture by voice.',
  unavailable: "Speech recognition isn't available here. Type instead.",
  failed: 'Listening stopped. Tap the mic to try again.',
};

/**
 * Capture mode: a big mic and a text box for getting an idea down fast. The
 * first word typed or said creates an untitled note with no parent, so it
 * lands in the Inbox, and the note follows the text from then on. Nothing is
 * created for a capture that stays empty.
 *
 * Opened by the "NotesGraph Capture" launcher on Android and the capture
 * window on desktop.
 */
export const CaptureView = ({
  autoListen = false,
  openNoteAt = 'active',
  compact = false,
}: {
  /** Start listening as soon as the view opens. */
  autoListen?: boolean;
  /** A smaller mic, for while the on-screen keyboard takes up the screen. */
  compact?: boolean;
  /** Where "Open note" opens it; the desktop capture window is too small. */
  openNoteAt?: 'active' | 'new-tab';
}) => {
  const voice = useService(VoiceTasksService);
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;

  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechToTextError | null>(null);
  const [docId, setDocId] = useState<string | null>(null);

  const sessionRef = useRef<SpeechToTextSession | null>(null);
  // Bumped per session and when the capture is left, so late callbacks can't
  // write into a capture that has moved on. Stopping doesn't bump it: the
  // sentence still being said arrives after the stop.
  const generationRef = useRef(0);
  const noteRef = useRef<{
    id: string;
    store: Store;
    release: () => void;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    voice
      .listen({
        onPartial: value => {
          if (current()) setPartial(value);
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
  }, [voice]);

  // Write what is on screen, the sentence still being said included, so
  // nothing is lost if the app is closed mid-sentence.
  const content = appendDictation(text, partial);
  const contentRef = useRef(content);
  contentRef.current = content;

  const save = useCallback(() => {
    const value = contentRef.current;
    if (!value.trim() && !noteRef.current) return;
    try {
      if (!noteRef.current) {
        const record = docsService.createDoc();
        const { doc, release } = docsService.open(record.id);
        noteRef.current = { id: record.id, store: doc.blockSuiteDoc, release };
        setDocId(record.id);
      }
      writeCapture(noteRef.current.store, value);
    } catch (err) {
      console.error('capture: failed to save', err);
    }
  }, [docsService]);

  useEffect(() => {
    if (!content.trim() && !noteRef.current) return;
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, save]);

  // Leaving a capture: write what the save delay hasn't yet, and send a note
  // that was emptied again to the trash rather than leave it in the Inbox.
  const finishCapture = useCallback(() => {
    generationRef.current++;
    stop();
    save();
    const note = noteRef.current;
    noteRef.current = null;
    if (!note) return;
    note.release();
    if (!contentRef.current.trim()) {
      docsService.list.doc$(note.id).value?.moveToTrash();
    }
  }, [docsService, save, stop]);

  useEffect(() => {
    if (autoListen && voice.supported) start();
    else textareaRef.current?.focus();
    return finishCapture;
  }, [autoListen, finishCapture, start, voice]);

  const newCapture = useCallback(() => {
    finishCapture();
    setText('');
    setPartial('');
    setDocId(null);
    textareaRef.current?.focus();
  }, [finishCapture]);

  const openNote = useCallback(() => {
    if (!docId) return;
    stop();
    save();
    workbench.openDoc(docId, { at: openNoteAt });
  }, [docId, openNoteAt, save, stop, workbench]);

  return (
    <div
      className={styles.root}
      data-compact={compact}
      data-testid="capture-view"
    >
      <button
        type="button"
        className={styles.mic}
        data-listening={listening}
        aria-label={listening ? 'Stop listening' : 'Start voice capture'}
        aria-pressed={listening}
        onClick={listening ? stop : start}
        data-testid="capture-mic"
      >
        <MicrophoneIcon />
      </button>
      {error ? (
        <div className={styles.error} role="alert">
          {errorMessages[error]}
        </div>
      ) : (
        <div className={styles.micLabel}>
          {listening
            ? 'Listening. Tap to stop.'
            : 'Tap to talk, or type below.'}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What's the idea?"
        aria-label="Capture text"
        data-testid="capture-text"
      />
      <div className={styles.partial} aria-live="polite">
        {partial}
      </div>
      <div className={styles.footer}>
        <span className={styles.status} data-testid="capture-status">
          {docId
            ? 'Saving to your Inbox as you go.'
            : 'A note is saved to your Inbox once you start.'}
        </span>
        <Button disabled={!docId} onClick={openNote}>
          Open note
        </Button>
        <Button variant="primary" disabled={!docId} onClick={newCapture}>
          New capture
        </Button>
      </div>
    </div>
  );
};
