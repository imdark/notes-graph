export interface MicrophoneRecording {
  /** Stop recording; resolves with the audio, or null if none came through. */
  stop(): Promise<Blob | null>;
}

/**
 * Record the mic with the browser's MediaRecorder, alongside a recognizer
 * listening to it (Chromium and Safari let both have the mic at once).
 * Resolves once recording has begun, or with null where it can't: no
 * MediaRecorder, or the mic refused.
 */
export async function recordMicrophone(): Promise<MicrophoneRecording | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn('voice: could not record the microphone', err);
    return null;
  }
  const releaseMic = () => stream.getTracks().forEach(track => track.stop());

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (err) {
    console.warn('voice: could not record the microphone', err);
    releaseMic();
    return null;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  // An error stops the recorder too, so this settles either way.
  const recorded = new Promise<Blob | null>(resolve => {
    recorder.onstop = () => {
      releaseMic();
      resolve(
        chunks.length > 0
          ? new Blob(chunks, { type: recorder.mimeType || chunks[0].type })
          : null
      );
    };
  });
  try {
    recorder.start();
  } catch (err) {
    console.warn('voice: could not record the microphone', err);
    releaseMic();
    return null;
  }

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return recorded;
    },
  };
}
