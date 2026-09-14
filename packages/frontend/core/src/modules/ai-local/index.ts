import type { Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { GlobalState } from '../storage';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { AiBackendService } from './services/ai-backend';
import { DocEmbedder } from './services/doc-embedder';
import { GoBoardOcrService } from './services/go-board-ocr';
import { LocalEmbeddingService } from './services/local-embedding';
import { LocalImageService } from './services/local-image';
import { LocalLLMService } from './services/local-llm';
import { LocalVisionService } from './services/local-vision';
import { SpeechService } from './services/speech';

export { type AiBackend, AiBackendService } from './services/ai-backend';
export {
  DocEmbedder,
  type DocEmbedderStatus,
  findMergeablePairs,
  type MergeSuggestion,
  type RelatedDoc,
} from './services/doc-embedder';
export {
  type GoBoardDetection,
  GoBoardOcrService,
  type GoBoardOcrStatus,
} from './services/go-board-ocr';
export { createLocalAIRequestService } from './services/local-copilot-client';
export { mergeDocs } from './services/merge-docs';
export {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  LocalEmbeddingService,
  type LocalEmbeddingStatus,
} from './services/local-embedding';
export {
  DEFAULT_IMAGE_MODEL,
  LocalImageService,
  type LocalImageStatus,
} from './services/local-image';
export {
  DEFAULT_LOCAL_MODEL,
  LocalLLMService,
  type LocalLLMStatus,
} from './services/local-llm';
export {
  CAPTION_MODEL,
  LocalVisionService,
  type LocalVisionStatus,
} from './services/local-vision';
export { SpeechService, stripMarkdown } from './services/speech';
export {
  type VectorChunk,
  type VectorSearchResult,
  VectorStore,
} from './services/vector-store';
export { buildBesogoHtml } from './utils/besogo-embed';
export { type Board, boardToSgf } from './utils/sgf';
export { detectWebGPU, type WebGPUCapability } from './utils/webgpu';
export { LocalAiSetting } from './views/local-ai-setting';
export { RelatedDocsPanel } from './views/related-docs-panel';

/**
 * Local-first AI: lets users run NotesGraph's AI features on-device (WebGPU models
 * in workers) instead of the cloud copilot. P0 = backend selection + WebGPU
 * probe; later phases add the local LLM/embeddings workers and the swap.
 */
export function configureAiLocalModule(framework: Framework) {
  framework.service(AiBackendService, [GlobalState]);
  framework.service(LocalLLMService);
  framework.service(LocalEmbeddingService);
  framework.service(LocalImageService);
  framework.service(LocalVisionService);
  framework.service(GoBoardOcrService);
  framework.service(SpeechService);
  framework
    .scope(WorkspaceScope)
    .service(DocEmbedder, [
      WorkspaceService,
      DocsService,
      LocalEmbeddingService,
    ]);
}
