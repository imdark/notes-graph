import { WorkspaceServerService } from '@notesgraph/core/modules/cloud';
import { NbstoreService } from '@notesgraph/core/modules/storage';
import {
  WorkspaceScope,
  WorkspaceService,
} from '@notesgraph/core/modules/workspace';
import { type Framework } from '@notesgraph/infra';

import { AdditionalAttachments } from './entities/additional-attachments';
import { EmbeddingEnabled } from './entities/embedding-enabled';
import { EmbeddingProgress } from './entities/embedding-progress';
import { IgnoredDocs } from './entities/ignored-docs';
import { EmbeddingService } from './services/embedding';
import { EmbeddingStore } from './stores/embedding';

export function configureIndexerEmbeddingModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(EmbeddingService)
    .store(EmbeddingStore, [WorkspaceServerService, NbstoreService])
    .entity(EmbeddingEnabled, [WorkspaceService, EmbeddingStore])
    .entity(AdditionalAttachments, [WorkspaceService, EmbeddingStore])
    .entity(IgnoredDocs, [WorkspaceService, EmbeddingStore])
    .entity(EmbeddingProgress, [WorkspaceService, EmbeddingStore]);
}

export { EmbeddingSettings } from './view';
