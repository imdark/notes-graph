/**
 * Video capture (with audio) — runs at document_start in the page's MAIN world
 * (see manifest content_scripts, scoped to LinkedIn/Facebook).
 *
 * LinkedIn/Facebook play video through Media Source Extensions, and DASH streams
 * the audio in a SEPARATE SourceBuffer from the video — so concatenating the raw
 * fMP4 segments yields a video-only file. To get audio + video muxed in ONE
 * file without shipping ffmpeg, we record the playing <video> element's
 * captureStream() with a MediaRecorder: that stream carries both tracks and the
 * recorder muxes them (to WebM). This is realtime, so whatever the user has
 * played is what's captured.
 *
 * Fallback: if captureStream()/MediaRecorder is unavailable or the media is
 * tainted, we keep a copy of the appended MSE segments (video track only) so the
 * clip still archives *something*.
 */
(function () {
  if (window.__ngMseHooked) return;
  window.__ngMseHooked = true;

  var MAX_BYTES = 80 * 1024 * 1024;

  var store = (window.__ngCapturedMedia = window.__ngCapturedMedia || {
    segBuffers: [], // fallback: raw MSE segments (video-only)
    recordings: [], // preferred: MediaRecorder webm (video + audio)
  });

  // ---------- preferred path: record the playing element (audio + video) ------
  function pickRecorderMime() {
    var candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (
          typeof MediaRecorder !== 'undefined' &&
          MediaRecorder.isTypeSupported(candidates[i])
        ) {
          return candidates[i];
        }
      } catch (e) {}
    }
    return '';
  }

  function startRecording(video) {
    if (
      !video ||
      video.__ngRec ||
      typeof MediaRecorder === 'undefined' ||
      typeof video.captureStream !== 'function'
    ) {
      return;
    }
    try {
      var stream = video.captureStream();
      if (!stream || !stream.getTracks || stream.getTracks().length === 0) {
        return;
      }
      var mime = pickRecorderMime();
      var rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      var entry = {
        chunks: [],
        bytes: 0,
        mime: rec.mimeType || mime || 'video/webm',
        hasAudio: stream.getAudioTracks().length > 0,
        stopped: false,
      };
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size && entry.bytes < MAX_BYTES) {
          entry.chunks.push(e.data);
          entry.bytes += e.data.size;
          if (entry.bytes >= MAX_BYTES) {
            try {
              rec.stop();
            } catch (x) {}
          }
        }
      };
      rec.onstop = function () {
        entry.stopped = true;
      };
      rec.start(1000); // gather in 1s chunks
      video.__ngRec = entry;
      entry.recorder = rec;
      store.recordings.push(entry);
    } catch (e) {
      /* tainted stream / not allowed — fall back to segment capture */
    }
  }

  // Catch every <video> that starts playing (capture phase reaches them all).
  document.addEventListener(
    'play',
    function (e) {
      var t = e.target;
      if (t && t.tagName === 'VIDEO') startRecording(t);
    },
    true
  );

  // ---------- fallback path: copy MSE segments (video track only) -------------
  if (typeof MediaSource !== 'undefined' && MediaSource.prototype) {
    var origAdd = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mime) {
      var sb = origAdd.call(this, mime);
      var rec = { mime: String(mime || ''), chunks: [], bytes: 0 };
      store.segBuffers.push(rec);
      try {
        var origAppend = sb.appendBuffer;
        sb.appendBuffer = function (data) {
          try {
            var u8 =
              data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : data && data.buffer
                  ? new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
                  : null;
            if (u8 && rec.bytes + u8.length <= MAX_BYTES) {
              rec.chunks.push(u8.slice(0));
              rec.bytes += u8.length;
            }
          } catch (e) {}
          return origAppend.call(this, data);
        };
      } catch (e) {}
      return sb;
    };
  }

  // ---------- assembly --------------------------------------------------------
  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        resolve(null);
      };
      fr.readAsDataURL(blob);
    });
  }

  /**
   * Resolve to `{ ext, mime, hasAudio, truncated, dataUrl }` or null. Prefers a
   * MediaRecorder recording (has audio); falls back to concatenated MSE
   * segments (video only).
   */
  window.__ngAssembleCapturedVideo = function () {
    // 1) best MediaRecorder recording (audio + video)
    var best = null;
    for (var i = 0; i < store.recordings.length; i++) {
      var r = store.recordings[i];
      if (r.bytes > 0 && (!best || r.bytes > best.bytes)) best = r;
    }
    if (best) {
      var finish = function () {
        var blob = new Blob(best.chunks, { type: best.mime });
        var ext = /mp4/.test(best.mime) ? 'mp4' : 'webm';
        return blobToDataUrl(blob).then(function (dataUrl) {
          return dataUrl
            ? {
                ext: ext,
                mime: best.mime,
                hasAudio: !!best.hasAudio,
                truncated: best.bytes >= MAX_BYTES,
                dataUrl: dataUrl,
              }
            : null;
        });
      };
      // Stop the recorder to flush the final chunk, then assemble.
      if (best.recorder && !best.stopped) {
        return new Promise(function (resolve) {
          best.recorder.addEventListener('stop', function () {
            finish().then(resolve);
          });
          try {
            best.recorder.stop();
          } catch (e) {
            finish().then(resolve);
          }
        });
      }
      return finish();
    }

    // 2) fallback: concat the largest video SourceBuffer's segments (no audio)
    var seg = null;
    for (var j = 0; j < store.segBuffers.length; j++) {
      var b = store.segBuffers[j];
      if (!b.bytes) continue;
      if (/audio\//i.test(b.mime)) continue;
      if (!seg || b.bytes > seg.bytes) seg = b;
    }
    if (!seg) return Promise.resolve(null);
    var merged = new Uint8Array(seg.bytes);
    var off = 0;
    for (var k = 0; k < seg.chunks.length; k++) {
      merged.set(seg.chunks[k], off);
      off += seg.chunks[k].length;
    }
    var container = (seg.mime.split(';')[0] || 'video/mp4').trim();
    if (!/^video\//.test(container)) container = 'video/mp4';
    return blobToDataUrl(new Blob([merged], { type: container })).then(function (
      dataUrl
    ) {
      return dataUrl
        ? {
            ext: 'mp4',
            mime: container,
            hasAudio: false,
            truncated: seg.bytes >= MAX_BYTES,
            dataUrl: dataUrl,
          }
        : null;
    });
  };
})();
