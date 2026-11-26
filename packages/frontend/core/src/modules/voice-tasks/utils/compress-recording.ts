import { toArrayBuffer } from '@notesgraph/core/utils/array-buffer';
import { encodeAudioBlobToOpus } from '@notesgraph/core/utils/opus-encoding';

/** Speech needs far less than music's 64 kbps. */
const SPEECH_BITRATE = 32_000;

/**
 * Uncompressed audio (WAV, as the phone's own recognizer records it) takes
 * about 2 MB a minute; make it Opus, a tenth of that. Anything else is kept
 * as it is, and so is the WAV where it can't be encoded here.
 */
export async function compressRecording(audio: Blob): Promise<Blob> {
  if (audio.type !== 'audio/wav') return audio;
  try {
    const encoded = await encodeAudioBlobToOpus(audio, SPEECH_BITRATE);
    return new Blob([toArrayBuffer(encoded)], { type: 'audio/mp4' });
  } catch (err) {
    console.warn('capture: keeping the recording as WAV', err);
    return audio;
  }
}
