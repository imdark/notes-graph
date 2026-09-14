import type { Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { WorkspaceScope } from '../workspace';
import { VideoIngestionService } from './services/video-ingestion';

export {
  chunkTranscript,
  type IngestedVideoDoc,
  isYoutubeVideoUrl,
  VideoIngestionService,
  type VideoTranscriptPayload,
} from './services/video-ingestion';

/**
 * Video ingestion: drop a video link, get a searchable transcript doc wired
 * into the archive alongside your notes (YouTube for now).
 */
export function configureVideoIngestionModule(framework: Framework) {
  framework.scope(WorkspaceScope).service(VideoIngestionService, [DocsService]);
}
