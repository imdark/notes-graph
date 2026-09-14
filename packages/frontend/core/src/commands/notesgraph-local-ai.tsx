import { AiIcon } from '@blocksuite/icons/rc';
import { type Store, Text, type Workspace } from '@blocksuite/notesgraph/store';
import { IconType } from '@notesgraph/component';

import { extractMarkdownFromDoc } from '../blocksuite/ai/utils/extract';
import { insertFromMarkdown } from '../blocksuite/utils/markdown-utils';
import {
  buildBesogoHtml,
  type GoBoardOcrService,
  type LocalImageService,
  type LocalLLMService,
  type SpeechService,
  stripMarkdown,
} from '../modules/ai-local';
import type { ExplorerIconService } from '../modules/explorer-icon/services/explorer-icon';
import { registerNotesGraphCommand } from './registry';

interface VoiceCommandDeps {
  speechService: SpeechService;
  docCollection: Workspace;
  getActiveDocId: () => string | null;
  createDoc: () => string;
  openDoc: (docId: string) => void;
  notify: (message: string) => void;
}

function storeOf(docCollection: Workspace, docId: string): Store | null {
  return docCollection.getDoc(docId)?.getStore({ id: docId }) ?? null;
}

export function registerLocalAiVoiceCommands({
  speechService,
  docCollection,
  getActiveDocId,
  createDoc,
  openDoc,
  notify,
}: VoiceCommandDeps) {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:local-ai-read-aloud',
      category: 'notesgraph:general',
      icon: <AiIcon />,
      label: 'Read this document aloud',
      run() {
        if (!speechService.ttsSupported) {
          notify('Text-to-speech is not supported in this browser');
          return;
        }
        const docId = getActiveDocId();
        const store = docId ? storeOf(docCollection, docId) : null;
        if (!store) {
          notify('Open a document first');
          return;
        }
        extractMarkdownFromDoc(store)
          .then(markdown => speechService.speak(stripMarkdown(markdown)))
          .catch(() => notify('Could not read this document'));
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:local-ai-stop-reading',
      category: 'notesgraph:general',
      icon: <AiIcon />,
      label: 'Stop reading aloud',
      run() {
        speechService.stopSpeaking();
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:local-ai-dictate',
      category: 'notesgraph:general',
      icon: <AiIcon />,
      label: 'Dictate a new note (voice to text)',
      run() {
        if (!speechService.sttSupported) {
          notify('Voice input is not supported in this browser');
          return;
        }
        if (speechService.listening$.value) {
          speechService.stopListening();
          return;
        }
        const docId = createDoc();
        openDoc(docId);
        const store = storeOf(docCollection, docId);
        const noteId = store?.getBlocksByFlavour('notesgraph:note')[0]?.id;
        notify('Listening… speak now, then run the command again to stop');
        speechService.startListening({
          onResult: () => {},
          onEnd: finalText => {
            if (finalText && store && noteId) {
              insertFromMarkdown(undefined, finalText, store, noteId).catch(
                () => {}
              );
            }
          },
        });
      },
    })
  );

  return () => unsubs.forEach(unsub => unsub());
}

interface IconCommandDeps {
  llm: LocalLLMService;
  explorerIconService: ExplorerIconService;
  docCollection: Workspace;
  getActiveDocId: () => string | null;
  getDocTitle: (docId: string) => string;
  notify: (message: string) => void;
}

/**
 * Ask the local LLM for emoji suggestions representing the doc. Shared by
 * the command palette and the doc-header icon panel.
 */
export async function pickEmojisForDoc(
  llm: LocalLLMService,
  docCollection: Workspace,
  docId: string,
  title: string,
  count = 6
): Promise<string[]> {
  const store = storeOf(docCollection, docId);
  const body = store
    ? stripMarkdown(await extractMarkdownFromDoc(store)).slice(0, 500)
    : '';
  const reply = await llm.complete([
    {
      role: 'system',
      content: `You suggest ${count} distinct emoji that could represent a note, best first. Reply with only the emoji separated by spaces, nothing else.`,
    },
    { role: 'user', content: `Title: ${title}\n\n${body}` },
  ]);
  const all = reply.match(/\p{Extended_Pictographic}/gu) ?? [];
  return Array.from(new Set(all)).slice(0, count);
}

/** First (best) emoji suggestion — used by the command palette. */
export async function pickEmojiForDoc(
  llm: LocalLLMService,
  docCollection: Workspace,
  docId: string,
  title: string
): Promise<string | null> {
  const emojis = await pickEmojisForDoc(llm, docCollection, docId, title, 3);
  return emojis[0] ?? null;
}

export function registerLocalAiIconCommands({
  llm,
  explorerIconService,
  docCollection,
  getActiveDocId,
  getDocTitle,
  notify,
}: IconCommandDeps) {
  return registerNotesGraphCommand({
    id: 'notesgraph:local-ai-generate-icon',
    category: 'notesgraph:general',
    icon: <AiIcon />,
    label: 'Generate an icon for this document',
    run() {
      const docId = getActiveDocId();
      if (!docId) {
        notify('Open a document first');
        return;
      }
      const title = getDocTitle(docId);
      notify('Generating icon…');
      void pickEmojiForDoc(llm, docCollection, docId, title)
        .then(emoji => {
          if (!emoji) {
            notify('Could not generate an icon');
            return;
          }
          explorerIconService.setIcon({
            where: 'doc',
            id: docId,
            icon: { type: IconType.Emoji, unicode: emoji },
          });
          notify(`Icon set to ${emoji}`);
        })
        .catch(() => notify('Could not generate an icon'));
    },
  });
}

interface ImageCommandDeps {
  imageService: LocalImageService;
  docCollection: Workspace;
  getActiveDocId: () => string | null;
  notify: (message: string) => void;
}

/**
 * Insert a generated image as an `notesgraph:image` block at the end of the doc's
 * first note. Mirrors BlockSuite's `addImageBlocks` (blob → blobSync sourceId →
 * image block), but works from a {@link Store} alone — this runs from ⌘K, where
 * there's no `EditorHost`/`std` to pass to the blessed helper.
 */
async function insertImageIntoDoc(
  docCollection: Workspace,
  docId: string,
  blob: Blob
): Promise<boolean> {
  const store = storeOf(docCollection, docId);
  const noteId = store?.getBlocksByFlavour('notesgraph:note')[0]?.id;
  if (!store || !noteId) return false;
  // The image block needs natural dimensions; decode the blob to read them.
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  const sourceId = await store.blobSync.set(blob);
  store.addBlock(
    'notesgraph:image',
    { sourceId, width, height, size: blob.size },
    noteId
  );
  return true;
}

export function registerLocalAiImageCommands({
  imageService,
  docCollection,
  getActiveDocId,
  notify,
}: ImageCommandDeps) {
  return registerNotesGraphCommand({
    id: 'notesgraph:local-ai-generate-image',
    category: 'notesgraph:general',
    icon: <AiIcon />,
    label: 'Generate an image (AI)',
    run() {
      // Capture the target doc up front — generation is slow and the user may
      // navigate away; the image still belongs in the doc they asked from.
      const docId = getActiveDocId();
      if (!docId) {
        notify('Open a document first');
        return;
      }
      const prompt = window.prompt('Describe the image to generate');
      if (!prompt?.trim()) return;
      notify('Generating image… first run downloads ~1.5 GB and can be slow');
      void imageService
        .generate(prompt.trim())
        .then(async blob => {
          if (!blob) {
            notify('Image generation failed');
            return;
          }
          const inserted = await insertImageIntoDoc(docCollection, docId, blob);
          notify(
            inserted
              ? 'Image inserted into the document'
              : 'Image generated, but the document could not be found'
          );
        })
        .catch((err: unknown) =>
          notify(
            `Image generation failed: ${err instanceof Error ? err.message : 'unknown error'}`
          )
        );
    },
  });
}

interface GoBoardCommandDeps {
  ocr: GoBoardOcrService;
  docCollection: Workspace;
  getActiveDocId: () => string | null;
  notify: (message: string) => void;
}

/** Prompt for a single image file (photo or diagram). Mirrors `pickFiles`. */
function pickImageFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * Insert the interactive besogo widget (an `notesgraph:code` HTML-preview block) for
 * the detected position, plus a raw SGF code block beneath it for copy/replay in
 * other Go tools. The widget mirrors the AI HTML-artifact insertion
 * (`code-artifact.ts`): `preview: true` makes `notesgraph-html-preview` render it in
 * the sandboxed iframe. Like {@link insertImageIntoDoc}, this works from a
 * {@link Store} alone since ⌘K has no `EditorHost`/`std`.
 */
function insertGoBoardIntoDoc(
  docCollection: Workspace,
  docId: string,
  html: string,
  sgf: string
): boolean {
  const store = storeOf(docCollection, docId);
  const noteId = store?.getBlocksByFlavour('notesgraph:note')[0]?.id;
  if (!store || !noteId) return false;
  store.addBlock(
    'notesgraph:code',
    { text: new Text(html), language: 'html', preview: true },
    noteId
  );
  store.addBlock(
    'notesgraph:code',
    { text: new Text(sgf), language: 'text' },
    noteId
  );
  return true;
}

export function registerLocalAiGoBoardCommands({
  ocr,
  docCollection,
  getActiveDocId,
  notify,
}: GoBoardCommandDeps) {
  return registerNotesGraphCommand({
    id: 'notesgraph:local-ai-read-go-board',
    category: 'notesgraph:general',
    icon: <AiIcon />,
    label: 'Read Go board from image',
    run() {
      // Capture the target doc up front — picking + detection are async and the
      // user may navigate away; the board belongs in the doc they asked from.
      const docId = getActiveDocId();
      if (!docId) {
        notify('Open a document first');
        return;
      }
      void (async () => {
        const file = await pickImageFile();
        if (!file) return;
        notify('Reading Go board… first run downloads OpenCV (~10 MB)');
        const detection = await ocr.detect(file);
        const html = buildBesogoHtml(detection.sgf, detection.size);
        const inserted = insertGoBoardIntoDoc(
          docCollection,
          docId,
          html,
          detection.sgf
        );
        if (!inserted) {
          notify('Read the board, but the document could not be found');
          return;
        }
        notify(
          detection.confidence < 0.85
            ? `Inserted a ${detection.size}×${detection.size} board — low confidence, double-check the stones in the editor`
            : `Inserted a ${detection.size}×${detection.size} board — edit it in the widget`
        );
      })().catch((err: unknown) =>
        notify(
          `Could not read the Go board: ${err instanceof Error ? err.message : 'unknown error'}`
        )
      );
    },
  });
}
