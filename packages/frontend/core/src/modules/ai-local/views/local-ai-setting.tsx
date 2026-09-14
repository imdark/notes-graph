import { Button, Switch } from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useState } from 'react';

import { AiBackendService } from '../services/ai-backend';
import { DocEmbedder } from '../services/doc-embedder';
import { GoBoardOcrService } from '../services/go-board-ocr';
import { LocalImageService } from '../services/local-image';
import { DEFAULT_LOCAL_MODEL, LocalLLMService } from '../services/local-llm';
import { LocalVisionService } from '../services/local-vision';
import { detectWebGPU, type WebGPUCapability } from '../utils/webgpu';

/**
 * Lets the user run NotesGraph's AI on-device (local WebGPU models) instead of the
 * cloud copilot, and manage the local model download. WebGPU is required for
 * local chat, so the toggle is gated on the capability probe.
 */
export const LocalAiSetting = () => {
  const aiBackend = useService(AiBackendService);
  const backend = useLiveData(aiBackend.backend$);
  const llm = useService(LocalLLMService);
  const status = useLiveData(llm.status$);
  const docEmbedder = useService(DocEmbedder);
  const embedStatus = useLiveData(docEmbedder.status$);
  const imageService = useService(LocalImageService);
  const imageStatus = useLiveData(imageService.status$);
  const visionService = useService(LocalVisionService);
  const visionStatus = useLiveData(visionService.status$);
  const goBoardService = useService(GoBoardOcrService);
  const goBoardStatus = useLiveData(goBoardService.status$);
  const [webgpu, setWebgpu] = useState<WebGPUCapability | null>(null);

  useEffect(() => {
    let active = true;
    detectWebGPU()
      .then(result => {
        if (active) setWebgpu(result);
      })
      .catch(() => {
        if (active)
          setWebgpu({ available: false, reason: 'WebGPU init failed' });
      });
    return () => {
      active = false;
    };
  }, []);

  const webgpuDesc =
    webgpu == null
      ? 'Checking…'
      : webgpu.available
        ? 'Available — local AI can run on this device.'
        : (webgpu.reason ?? 'Not available on this device.');

  const modelDesc =
    status.state === 'loading'
      ? `Downloading… ${Math.round(status.progress * 100)}% — ${status.text}`
      : status.state === 'ready'
        ? `Ready (${llm.currentModel ?? DEFAULT_LOCAL_MODEL})`
        : status.state === 'error'
          ? `Error: ${status.error}`
          : 'Download the model to run AI on-device (~0.9 GB first time, cached afterwards).';

  const embedDesc =
    embedStatus.state === 'indexing'
      ? `Indexing… ${embedStatus.done}/${embedStatus.total} docs`
      : embedStatus.state === 'ready'
        ? `Indexed ${embedStatus.docs} docs (${embedStatus.chunks} chunks) — semantic search and doc-aware chat are enabled.`
        : embedStatus.state === 'error'
          ? `Error: ${embedStatus.error}`
          : 'Index your documents on-device (~30 MB embedding model) for semantic search and to let chat use your notes as context.';

  const imageDesc =
    imageStatus.state === 'loading'
      ? imageStatus.progress != null
        ? `Downloading… ${Math.round(imageStatus.progress * 100)}% — ${imageStatus.text}`
        : `Loading… ${imageStatus.text}`
      : imageStatus.state === 'generating'
        ? `Generating… step ${imageStatus.step}/${imageStatus.total}`
        : imageStatus.state === 'ready'
          ? 'Ready (Dreamshaper LCM) — use “Generate an image (AI)” from ⌘K.'
          : imageStatus.state === 'error'
            ? `Error: ${imageStatus.error}`
            : 'Text-to-image, experimental (~1.5 GB, needs WebGPU). Download here, then run “Generate an image (AI)” from ⌘K.';

  const visionDesc =
    visionStatus.state === 'loading'
      ? `Downloading… ${Math.round(visionStatus.progress * 100)}% — ${visionStatus.text}`
      : visionStatus.state === 'ready'
        ? 'Ready (ViT-GPT2) — “Explain this image” works on-device.'
        : visionStatus.state === 'error'
          ? `Error: ${visionStatus.error}`
          : 'Image understanding for “Explain this image”, experimental (~250 MB). Downloads on first use, or download here.';

  const goBoardDesc =
    goBoardStatus.state === 'loading'
      ? 'Loading OpenCV…'
      : goBoardStatus.state === 'ready'
        ? 'Ready — run “Read Go board from image” from ⌘K.'
        : goBoardStatus.state === 'error'
          ? `Error: ${goBoardStatus.error}`
          : 'Read a Go position from a photo or printed/screenshot diagram into an editable board, on-device (~10 MB OpenCV). Downloads on first use, or download here.';

  return (
    <SettingWrapper title="On-device AI">
      <SettingRow
        name="Run AI on this device"
        desc="Use local WebGPU models instead of the cloud — private and works offline. Quality is lower than the cloud, and models download once (cached afterwards)."
      >
        <Switch
          checked={backend === 'local'}
          onChange={checked =>
            aiBackend.setBackend(checked ? 'local' : 'cloud')
          }
          disabled={!webgpu?.available}
        />
      </SettingRow>
      <SettingRow name="WebGPU" desc={webgpuDesc}>
        <span />
      </SettingRow>
      {backend === 'local' ? (
        <>
          <SettingRow name="Local model" desc={modelDesc}>
            {status.state === 'ready' ? (
              <Button
                onClick={() => {
                  llm.unload().catch(() => {
                    /* surfaced via status$ */
                  });
                }}
              >
                Unload
              </Button>
            ) : (
              <Button
                onClick={() => {
                  llm.ensureLoaded().catch(() => {
                    /* surfaced via status$ */
                  });
                }}
                loading={status.state === 'loading'}
                disabled={status.state === 'loading'}
              >
                Download
              </Button>
            )}
          </SettingRow>
          <SettingRow name="Document index" desc={embedDesc}>
            <Button
              onClick={() => {
                docEmbedder.indexAll().catch(() => {
                  /* surfaced via status$ */
                });
              }}
              loading={embedStatus.state === 'indexing'}
              disabled={embedStatus.state === 'indexing'}
            >
              {embedStatus.state === 'ready' ? 'Re-index' : 'Index'}
            </Button>
          </SettingRow>
          <SettingRow name="Image model (experimental)" desc={imageDesc}>
            <Button
              onClick={() => {
                imageService.ensureLoaded().catch(() => {
                  /* surfaced via status$ */
                });
              }}
              loading={imageStatus.state === 'loading'}
              disabled={
                imageStatus.state === 'loading' ||
                imageStatus.state === 'ready' ||
                !webgpu?.available
              }
            >
              {imageStatus.state === 'ready' ? 'Downloaded' : 'Download'}
            </Button>
          </SettingRow>
          <SettingRow
            name="Image understanding (experimental)"
            desc={visionDesc}
          >
            <Button
              onClick={() => {
                visionService.ensureLoaded().catch(() => {
                  /* surfaced via status$ */
                });
              }}
              loading={visionStatus.state === 'loading'}
              disabled={
                visionStatus.state === 'loading' ||
                visionStatus.state === 'ready'
              }
            >
              {visionStatus.state === 'ready' ? 'Downloaded' : 'Download'}
            </Button>
          </SettingRow>
          <SettingRow name="Go board reader (experimental)" desc={goBoardDesc}>
            <Button
              onClick={() => {
                goBoardService.ensureLoaded().catch(() => {
                  /* surfaced via status$ */
                });
              }}
              loading={goBoardStatus.state === 'loading'}
              disabled={
                goBoardStatus.state === 'loading' ||
                goBoardStatus.state === 'ready'
              }
            >
              {goBoardStatus.state === 'ready' ? 'Downloaded' : 'Download'}
            </Button>
          </SettingRow>
        </>
      ) : null}
    </SettingWrapper>
  );
};
