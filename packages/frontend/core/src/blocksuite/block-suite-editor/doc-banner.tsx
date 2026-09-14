import { AiOutlineIcon, CloseIcon } from '@blocksuite/icons/rc';
import {
  Button,
  IconButton,
  type IconData,
  IconType,
  Menu,
  toast,
} from '@notesgraph/component';
import { pickEmojisForDoc } from '@notesgraph/core/commands/notesgraph-local-ai';
import {
  LocalImageService,
  LocalLLMService,
} from '@notesgraph/core/modules/ai-local';
import { DocsService } from '@notesgraph/core/modules/doc';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BANNER_PRESETS,
  type BannerPreset,
  bannerPresetDataUrl,
  bannerPresetToBlob,
} from './banner-presets';
import * as styles from './doc-banner.css';

// SD1.5-based LCM tops out before ~1200px without tiling artifacts; 1152px
// wide matches the banner's retina display size (~660 CSS px) closely.
const BANNER_SIZE = { width: 1152, height: 384, steps: 12 };
const ICON_SIZE = { width: 512, height: 512, steps: 8 };
const CANDIDATE_COUNT = 3;
const BANNER_PROPERTY = 'banner';

interface Candidate {
  blob: Blob;
  url: string;
}

/** On-device generation is only available where WebGPU exists. */
export const aiImageGenSupported = () =>
  typeof navigator !== 'undefined' && 'gpu' in navigator;

/** Downscale a generated image to a small, self-contained data URL icon. */
export async function blobToIconDataUrl(blob: Blob, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.85);
}

function useDocTitle(docId: string) {
  const docsService = useService(DocsService);
  const record = useLiveData(docsService.list.doc$(docId));
  return useLiveData(useMemo(() => record?.title$, [record])) || '';
}

function useGenerationStatusText(busy: boolean) {
  const localImageService = useService(LocalImageService);
  const status = useLiveData(localImageService.status$);
  return status.state === 'loading'
    ? ((status as { text?: string }).text ?? 'Loading model…')
    : status.state === 'generating'
      ? `Generating… step ${(status as { step?: number }).step ?? 0}/${(status as { total?: number }).total ?? 0}`
      : busy
        ? 'Working…'
        : '';
}

/** Sequentially generate N candidates; cancels when the ref generation moves on. */
function useCandidates() {
  const localImageService = useService(LocalImageService);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const generationRef = useRef(0);

  const reset = useCallback(() => {
    generationRef.current++;
    setCandidates(prev => {
      prev.forEach(c => URL.revokeObjectURL(c.url));
      return [];
    });
    setBusy(false);
  }, []);

  const generate = useCallback(
    async (
      prompt: string,
      size: { width: number; height: number; steps?: number }
    ) => {
      const gen = ++generationRef.current;
      setBusy(true);
      setCandidates(prev => {
        prev.forEach(c => URL.revokeObjectURL(c.url));
        return [];
      });
      try {
        for (let i = 0; i < CANDIDATE_COUNT; i++) {
          const blob = await localImageService.generate(prompt, {
            width: size.width,
            height: size.height,
            steps: size.steps ?? 8,
          });
          if (generationRef.current !== gen) return;
          if (blob) {
            const url = URL.createObjectURL(blob);
            setCandidates(prev => [...prev, { blob, url }]);
          }
        }
      } catch (err) {
        console.error('[doc-banner] generation failed:', err);
        toast('Image generation failed — see the error console');
      } finally {
        if (generationRef.current === gen) setBusy(false);
      }
    },
    [localImageService]
  );

  return { busy, candidates, generate, reset };
}

/** The banner strip above the doc title (rendered when the doc has one). */
export const DocBanner = ({
  docId,
  readonly,
}: {
  docId: string;
  readonly?: boolean;
}) => {
  const workspaceService = useService(WorkspaceService);
  const docsService = useService(DocsService);
  const record = useLiveData(docsService.list.doc$(docId));
  const bannerKey = useLiveData(
    useMemo(() => record?.customProperty$(BANNER_PROPERTY), [record])
  );
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  const blobSync = workspaceService.workspace.docCollection.blobSync;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!bannerKey) {
      setBannerUrl(null);
      return;
    }
    blobSync
      .get(bannerKey)
      .then((blob: Blob | null) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBannerUrl(objectUrl);
      })
      .catch(() => {
        /* banner blob missing — show nothing */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bannerKey, blobSync]);

  const removeBanner = useCallback(() => {
    record?.setCustomProperty(BANNER_PROPERTY, '');
  }, [record]);

  if (!bannerUrl) return null;
  return (
    <div className={styles.bannerWrapper}>
      <img className={styles.bannerImage} src={bannerUrl} alt="doc banner" />
      {!readonly ? (
        <div className={styles.bannerActions} data-banner-actions>
          <IconButton size="16" onClick={removeBanner} tooltip="Remove banner">
            <CloseIcon />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Compact "Generate banner" button that sits inside the doc-icon container,
 * right next to the Add icon trigger.
 */
export const DocBannerGenerateButton = ({
  docId,
  readonly,
}: {
  docId: string;
  readonly?: boolean;
}) => {
  const workspaceService = useService(WorkspaceService);
  const docsService = useService(DocsService);
  const record = useLiveData(docsService.list.doc$(docId));
  const title = useDocTitle(docId);
  const bannerKey = useLiveData(
    useMemo(() => record?.customProperty$(BANNER_PROPERTY), [record])
  );
  const hasBanner = !!bannerKey;

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const { busy, candidates, generate, reset } = useCandidates();
  const statusText = useGenerationStatusText(busy);

  const defaultPrompt = useMemo(() => {
    const base = title.trim();
    return base
      ? `Abstract minimal banner artwork inspired by “${base}”, dark background, glowing graph lines, high quality`
      : 'Abstract minimal banner artwork, dark background, glowing graph lines, high quality';
  }, [title]);

  // upload works everywhere; only the AI generator needs WebGPU
  const aiSupported = aiImageGenSupported();
  if (readonly) return null;

  const apply = async (candidate: Candidate) => {
    try {
      const blobSync = workspaceService.workspace.docCollection.blobSync;
      const key = await blobSync.set(candidate.blob);
      record?.setCustomProperty(BANNER_PROPERTY, key);
      toast('Banner applied');
      setOpen(false);
      reset();
    } catch (err) {
      console.error('[doc-banner] apply failed:', err);
      toast('Could not apply the banner');
    }
  };

  const applyPreset = (preset: BannerPreset) => {
    void apply({ blob: bannerPresetToBlob(preset), url: '' });
  };

  const handleOpenChange = (next: boolean) => {
    if (next && !prompt) setPrompt(defaultPrompt);
    if (!next) reset();
    setOpen(next);
  };

  const uploadBanner = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void apply({ blob: file, url: '' });
    };
    input.click();
  };

  return (
    <Menu
      rootOptions={{ open, onOpenChange: handleOpenChange, modal: true }}
      contentOptions={{ side: 'bottom', align: 'start', sideOffset: 4 }}
      items={
        <div className={styles.menuPanel}>
          <Button
            variant="secondary"
            size="default"
            onClick={uploadBanner}
          >
            Upload an image…
          </Button>
          {hasBanner ? (
            <Button
              variant="secondary"
              size="default"
              onClick={() => {
                record?.setCustomProperty(BANNER_PROPERTY, '');
                toast('Banner removed');
                setOpen(false);
                reset();
              }}
            >
              Remove banner
            </Button>
          ) : null}
          <span className={styles.statusText}>or pick a preset:</span>
          <div className={styles.presets}>
            {BANNER_PRESETS.map(preset => (
              <img
                key={preset.id}
                src={bannerPresetDataUrl(preset)}
                alt={preset.name}
                title={preset.name}
                className={styles.preset}
                data-testid={`doc-banner-preset-${preset.id}`}
                onClick={() => applyPreset(preset)}
              />
            ))}
          </div>
          {aiSupported ? (
            <span className={styles.statusText}>or generate one with AI:</span>
          ) : null}
          {aiSupported ? (
            <div className={styles.promptRow}>
              <input
                className={styles.promptInput}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the banner…"
              />
              <Button
                variant="primary"
                size="default"
                disabled={busy}
                onClick={() => {
                  void generate(prompt.trim() || defaultPrompt, BANNER_SIZE);
                }}
              >
                {candidates.length > 0 ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
          ) : null}
          {statusText ? (
            <span className={styles.statusText}>{statusText}</span>
          ) : null}
          {candidates.length > 0 ? (
            <div className={styles.candidates}>
              {candidates.map((c, i) => (
                <img
                  key={i}
                  src={c.url}
                  alt={`candidate ${i + 1}`}
                  className={`${styles.candidate} ${styles.candidateBanner}`}
                  onClick={() => {
                    void apply(c);
                  }}
                />
              ))}
            </div>
          ) : null}
          {aiSupported ? (
            <span className={styles.statusText}>
              Runs on your GPU — the first generation downloads the model
              (~1.5&nbsp;GB). Tap a result to apply it.
            </span>
          ) : null}
        </div>
      }
    >
      <button className={styles.addButton} data-testid="doc-ai-banner-button">
        <AiOutlineIcon className={styles.addButtonIcon} />
        <span>Add banner</span>
      </button>
    </Menu>
  );
};

/**
 * AI section rendered *inside* the Add-icon picker popup: generate image
 * icon candidates on-device, or ask the local LLM to pick an emoji.
 */
export const AiIconGenerator = ({
  docId,
  subject,
  onSelect,
  onApplied,
}: {
  /** The note the icon is for. Omit when the subject isn't a note. */
  docId?: string;
  /**
   * What the icon should depict, when it isn't a note's title — an agent's
   * name, say. Emoji suggestion needs a doc to read, so with no `docId` only
   * image generation is offered.
   */
  subject?: string;
  onSelect: (data: IconData) => void;
  onApplied?: () => void;
}) => {
  const workspaceService = useService(WorkspaceService);
  const localLLMService = useService(LocalLLMService);
  const docTitle = useDocTitle(docId ?? '');
  const title = subject ?? docTitle;
  const { busy, candidates, generate } = useCandidates();
  const statusText = useGenerationStatusText(busy);
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [emojiCandidates, setEmojiCandidates] = useState<string[]>([]);

  if (!aiImageGenSupported()) return null;

  const iconPrompt = title.trim()
    ? `Simple flat vector-style icon representing “${title.trim()}”, centered subject, dark background, high quality`
    : 'Simple flat vector-style icon, centered subject, dark background, high quality';

  const applyImage = async (candidate: Candidate) => {
    try {
      const url = await blobToIconDataUrl(candidate.blob);
      onSelect({ type: IconType.Blob, url });
      toast('Icon applied');
      onApplied?.();
    } catch (err) {
      console.error('[doc-banner] icon apply failed:', err);
      toast('Could not apply the icon');
    }
  };

  const suggestEmojis = async () => {
    if (!docId) return;
    setEmojiBusy(true);
    setEmojiCandidates([]);
    try {
      const emojis = await pickEmojisForDoc(
        localLLMService,
        workspaceService.workspace.docCollection,
        docId,
        title
      );
      if (emojis.length === 0) {
        toast('Could not suggest emoji');
        return;
      }
      setEmojiCandidates(emojis);
    } catch (err) {
      console.error('[doc-banner] emoji suggest failed:', err);
      toast('Could not suggest emoji');
    } finally {
      setEmojiBusy(false);
    }
  };

  return (
    <div className={styles.aiIconSection}>
      <span className={styles.aiIconPaneTitle}>AI</span>
      <Button
        variant="secondary"
        size="default"
        disabled={busy}
        prefix={<AiOutlineIcon />}
        onClick={() => {
          void generate(iconPrompt, ICON_SIZE);
        }}
      >
        {candidates.length > 0 ? 'Regenerate' : 'Generate icon'}
      </Button>
      {docId ? (
        <Button
          variant="secondary"
          size="default"
          disabled={emojiBusy || busy}
          onClick={() => {
            void suggestEmojis();
          }}
        >
          {emojiCandidates.length > 0 ? 'More emoji' : 'AI emoji'}
        </Button>
      ) : null}
      {emojiBusy ? (
        <span className={styles.statusText}>Suggesting…</span>
      ) : null}
      {emojiCandidates.length > 0 ? (
        <div className={styles.emojiCandidates}>
          {emojiCandidates.map(e => (
            <button
              key={e}
              className={styles.emojiCandidate}
              onClick={() => {
                onSelect({ type: IconType.Emoji, unicode: e });
                onApplied?.();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
      {statusText ? (
        <span className={styles.statusText}>{statusText}</span>
      ) : null}
      {candidates.length > 0 ? (
        <div className={styles.aiIconCandidates}>
          {candidates.map((c, i) => (
            <img
              key={i}
              src={c.url}
              alt={`icon candidate ${i + 1}`}
              className={`${styles.candidate} ${styles.candidateIcon}`}
              onClick={() => {
                void applyImage(c);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
