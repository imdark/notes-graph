import { MicrophoneIcon } from '@blocksuite/icons/rc';
import type { Store } from '@blocksuite/notesgraph/store';
import { Button } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { JournalService } from '@notesgraph/core/modules/journal';
import {
  addCaptureRecording,
  appendDictation,
  cleanDictation,
  compressRecording,
  type SpeechToTextError,
  type SpeechToTextSession,
  VoiceTasksService,
  writeCapture,
} from '@notesgraph/core/modules/voice-tasks';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './capture.css';
import { CaptureHandOff } from './hand-off';
import { OnDeviceModelOffer } from './on-device-model';
import { useDictationVocabulary } from './use-dictation-vocabulary';

/** How long typing has to pause before the note is rewritten. */
const SAVE_DELAY_MS = 400;

const errorMessages: Record<SpeechToTextError, string> = {
  'permission-denied': 'Allow microphone access to capture by voice.',
  unavailable: "Speech recognition isn't available here. Type instead.",
  failed: 'Listening stopped. Tap the mic to try again.',
};

/** One capture: its note, once there is one, and the recordings bound for it. */
interface Capture {
  note: { id: string; store: Store; release: () => void } | null;
  /** Recordings still on their way; the note is let go once they are in. */
  pending: Set<Promise<void>>;
  /** At least one recording made it into the note. */
  recorded: boolean;
  /** Left, with this text; closed once nothing is pending. */
  finishedWith: string | null;
}

const newCaptureState = (): Capture => ({
  note: null,
  pending: new Set(),
  recorded: false,
  finishedWith: null,
});

/**
 * Capture mode: a big mic and a text box for getting an idea down fast. The
 * first word typed or said creates an untitled note with no parent, so it
 * lands in the Inbox, and the note follows the text from then on. Each time
 * the mic listens, what it heard is also kept, as a recording at the top of
 * the note. Nothing is created for a capture that stays empty. "Hand to
 * agent" starts runs on the note with the agents picked from a list.
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
  const journalService = useService(JournalService);
  const workbench = useService(WorkbenchService).workbench;
  const handOffEnabled = useLiveData(
    useService(FeatureFlagService).flags.enable_capture_hand_off.$
  );

  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechToTextError | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  /** Names of the agents this capture was last handed to. */
  const [handedTo, setHandedTo] = useState<string[]>([]);

  const sessionRef = useRef<SpeechToTextSession | null>(null);
  // Bumped per session and when the capture is left, so late callbacks can't
  // write into a capture that has moved on. Stopping doesn't bump it: the
  // sentence still being said arrives after the stop.
  const generationRef = useRef(0);
  const captureRef = useRef<Capture>(newCaptureState());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const vocabularyRef = useDictationVocabulary();

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setListening(false);
    session?.stop().catch(console.error);
  }, []);

  /** The capture's note, made on its first word or recording. */
  const ensureNote = useCallback(
    (capture: Capture) => {
      if (capture.note) return capture.note;
      const record = docsService.createDoc();
      // marks it as a captured idea (it gets that special tag)
      record.setProperty('capturedAt', new Date().toISOString());
      const { doc, release } = docsService.open(record.id);
      capture.note = { id: record.id, store: doc.blockSuiteDoc, release };
      if (capture === captureRef.current) setDocId(record.id);
      journalService.addToTodayJournal(record.id).catch(console.error);
      return capture.note;
    },
    [docsService, journalService]
  );

  // A left capture lets its note go once its last recording is in, and sends
  // a note that ended up empty to the trash rather than leave it in the Inbox.
  const closeIfDone = useCallback(
    (capture: Capture) => {
      const note = capture.note;
      if (!note || capture.finishedWith === null || capture.pending.size > 0)
        return;
      capture.note = null;
      note.release();
      if (!capture.finishedWith.trim() && !capture.recorded) {
        docsService.list.doc$(note.id).value?.moveToTrash();
      }
    },
    [docsService]
  );

  const keepRecording = useCallback(
    (
      capture: Capture,
      recording: Promise<Blob | null | undefined>,
      startedAt: Date
    ) => {
      const task: Promise<void> = recording
        .then(async audio => {
          if (!audio?.size) return;
          const compressed = await compressRecording(audio);
          await addCaptureRecording(
            ensureNote(capture).store,
            compressed,
            startedAt
          );
          capture.recorded = true;
        })
        .catch(err => {
          console.error('capture: failed to save the recording', err);
        })
        .finally(() => {
          capture.pending.delete(task);
          closeIfDone(capture);
        });
      capture.pending.add(task);
    },
    [closeIfDone, ensureNote]
  );

  const start = useCallback(() => {
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    const startedAt = new Date();
    setError(null);
    setListening(true);
    const recording = voice
      .listen(
        {
          // Fillers dropped and the workspace's own spellings kept, in the
          // live text too, so what is shown is what gets saved.
          onPartial: value => {
            if (current())
              setPartial(cleanDictation(value, vocabularyRef.current));
          },
          onSegment: segment => {
            if (!current()) return;
            setPartial('');
            const words = cleanDictation(segment, vocabularyRef.current);
            setText(prev => appendDictation(prev, words));
          },
          onEnd: endError => {
            if (!current()) return;
            sessionRef.current = null;
            setListening(false);
            setPartial('');
            if (endError) setError(endError);
          },
        },
        { record: true }
      )
      .then(session => {
        if (current()) sessionRef.current = session;
        else session.stop().catch(console.error);
        return session.recording;
      })
      .catch(err => {
        console.error(err);
        if (current()) {
          setListening(false);
          setError('failed');
        }
        return null;
      });
    // Counted from the start, so a capture left mid-sentence still waits for
    // the recording before it lets the note go.
    keepRecording(captureRef.current, recording, startedAt);
  }, [keepRecording, voice, vocabularyRef]);

  // Write what is on screen, the sentence still being said included, so
  // nothing is lost if the app is closed mid-sentence.
  const content = appendDictation(text, partial);
  const contentRef = useRef(content);
  contentRef.current = content;

  const save = useCallback(() => {
    const value = contentRef.current;
    const capture = captureRef.current;
    if (!value.trim() && !capture.note) return;
    try {
      writeCapture(ensureNote(capture).store, value);
    } catch (err) {
      console.error('capture: failed to save', err);
    }
  }, [ensureNote]);

  useEffect(() => {
    if (!content.trim() && !captureRef.current.note) return;
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, save]);

  // Leaving a capture: write what the save delay hasn't yet. Its recordings
  // may still be on their way; they go to its note all the same.
  const finishCapture = useCallback(() => {
    generationRef.current++;
    stop();
    save();
    const capture = captureRef.current;
    captureRef.current = newCaptureState();
    capture.finishedWith = contentRef.current;
    closeIfDone(capture);
  }, [closeIfDone, save, stop]);

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
    setHandingOff(false);
    setHandedTo([]);
    textareaRef.current?.focus();
  }, [finishCapture]);

  const openNote = useCallback(() => {
    if (!docId) return;
    stop();
    save();
    workbench.openDoc(docId, { at: openNoteAt });
  }, [docId, openNoteAt, save, stop, workbench]);

  const flush = useCallback(() => {
    stop();
    save();
  }, [save, stop]);

  const getBlockIds = useCallback(() => {
    const store = captureRef.current.note?.store;
    const [note] = store?.getModelsByFlavour('notesgraph:note') ?? [];
    return note ? note.children.map(block => block.id) : [];
  }, []);

  const handedOff = useCallback((agents: { name: string }[]) => {
    setHandingOff(false);
    setHandedTo(agents.map(agent => agent.name));
  }, []);

  const status = handedTo.length
    ? `Handed to ${handedTo.join(', ')}. Follow it in Agents.`
    : docId
      ? 'Saving to your Inbox as you go.'
      : 'A note is saved to your Inbox once you start.';

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
          {status}
        </span>
        {handOffEnabled ? (
          <Button
            disabled={!docId}
            aria-expanded={handingOff}
            onClick={() => setHandingOff(open => !open)}
            data-testid="capture-hand-off-toggle"
          >
            Hand to agent
          </Button>
        ) : null}
        <Button disabled={!docId} onClick={openNote}>
          Open note
        </Button>
        <Button variant="primary" disabled={!docId} onClick={newCapture}>
          New capture
        </Button>
      </div>
      {compact ? null : <OnDeviceModelOffer />}
      {handOffEnabled && handingOff && docId ? (
        <CaptureHandOff
          docId={docId}
          getBlockIds={getBlockIds}
          onBeforeHandOff={flush}
          onHandedOff={handedOff}
          onCancel={() => setHandingOff(false)}
        />
      ) : null}
    </div>
  );
};
