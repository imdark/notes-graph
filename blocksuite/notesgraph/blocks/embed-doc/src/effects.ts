import { EmbedLinkedDocBlockComponent } from './embed-linked-doc-block';
import { EmbedSyncedBlockComponent } from './embed-synced-block';
import { SyncedFormulaEditor } from './embed-synced-block/synced-formula-editor';
import { EmbedEdgelessLinkedDocBlockComponent } from './embed-linked-doc-block/embed-edgeless-linked-doc-block';
import { EmbedSyncedDocBlockComponent } from './embed-synced-doc-block';
import { EmbedSyncedDocCard } from './embed-synced-doc-block/components/embed-synced-doc-card';
import { EmbedEdgelessSyncedDocBlockComponent } from './embed-synced-doc-block/embed-edgeless-synced-doc-block';

export function effects() {
  customElements.define('notesgraph-embed-synced-doc-card', EmbedSyncedDocCard);
  customElements.define(
    'notesgraph-embed-synced-block',
    EmbedSyncedBlockComponent
  );
  customElements.define(
    'notesgraph-synced-formula-editor',
    SyncedFormulaEditor
  );

  customElements.define(
    'notesgraph-embed-edgeless-linked-doc-block',
    EmbedEdgelessLinkedDocBlockComponent
  );
  customElements.define(
    'notesgraph-embed-linked-doc-block',
    EmbedLinkedDocBlockComponent
  );

  customElements.define(
    'notesgraph-embed-edgeless-synced-doc-block',
    EmbedEdgelessSyncedDocBlockComponent
  );
  customElements.define(
    'notesgraph-embed-synced-doc-block',
    EmbedSyncedDocBlockComponent
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-embed-synced-doc-card': EmbedSyncedDocCard;
    'notesgraph-embed-synced-doc-block': EmbedSyncedDocBlockComponent;
    'notesgraph-embed-edgeless-synced-doc-block': EmbedEdgelessSyncedDocBlockComponent;
    'notesgraph-embed-linked-doc-block': EmbedLinkedDocBlockComponent;
    'notesgraph-embed-edgeless-linked-doc-block': EmbedEdgelessLinkedDocBlockComponent;
    'notesgraph-synced-formula-editor': SyncedFormulaEditor;
  }
}
