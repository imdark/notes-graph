import { EmbedSyncedDocConfigExtension } from '@blocksuite/notesgraph/blocks/embed-doc';
import { NoteConfigExtension } from '@blocksuite/notesgraph/blocks/note';
import { EDGELESS_BLOCK_CHILD_PADDING } from '@blocksuite/notesgraph/blocks/root';
import { Bound, Vec } from '@blocksuite/notesgraph/global/gfx';
import {
  DocModeProvider,
  EditPropsStore,
} from '@blocksuite/notesgraph/shared/services';
import { GfxControllerIdentifier } from '@blocksuite/notesgraph/std/gfx';
import type { ReactToLit } from '@notesgraph/component';
import { JournalService } from '@notesgraph/core/modules/journal';
import type { FrameworkProvider } from '@notesgraph/infra';
import { html } from 'lit';

import { BlocksuiteEditorJournalDocTitle } from '../../block-suite-editor/journal-doc-title';
import { EdgelessEmbedSyncedDocHeader } from './edgeless-embed-synced-doc-header';
import { EdgelessNoteHeader } from './edgeless-note-header';

export function patchForEdgelessNoteConfig(
  framework: FrameworkProvider,
  reactToLit: ReactToLit,
  insidePeekView: boolean
) {
  return NoteConfigExtension({
    edgelessNoteHeader: ({ note }) =>
      reactToLit(<EdgelessNoteHeader note={note} />),
    pageBlockTitle: ({ note }) => {
      const journalService = framework.get(JournalService);
      const isJournal = !!journalService.journalDate$(note.store.id).value;
      if (isJournal) {
        return reactToLit(
          <BlocksuiteEditorJournalDocTitle page={note.store} />
        );
      } else {
        return html`<doc-title .doc=${note.store}></doc-title>`;
      }
    },
    pageBlockViewportFitAnimation: insidePeekView
      ? undefined
      : ({ std, note }) => {
          const storedViewport = std.get(EditPropsStore).getStorage('viewport');
          // if there is a stored viewport, don't run the animation
          // in other word, this doc has been opened before
          if (storedViewport) return false;

          if (!std.store.root) return false;
          const rootView = std.view.getBlock(std.store.root.id);
          if (!rootView) return false;

          const gfx = std.get(GfxControllerIdentifier);
          const primaryMode = std
            .get(DocModeProvider)
            .getPrimaryMode(std.store.id);

          if (primaryMode !== 'page' || !note || note.props.edgeless.collapse) {
            return false;
          }

          const leftPadding = parseInt(
            window
              .getComputedStyle(rootView)
              .getPropertyValue('--notesgraph-editor-side-padding')
              .replace('px', '')
          );
          if (isNaN(leftPadding)) {
            return false;
          }

          let editorWidth = parseInt(
            window
              .getComputedStyle(rootView)
              .getPropertyValue('--notesgraph-editor-width')
              .replace('px', '')
          );
          if (isNaN(editorWidth)) {
            return false;
          }

          const containerWidth = rootView.getBoundingClientRect().width;
          const leftMargin =
            containerWidth > editorWidth
              ? (containerWidth - editorWidth) / 2
              : 0;

          const pageTitleAnchor = gfx.viewport.toModelCoord(
            leftPadding + leftMargin,
            0
          );

          const noteBound = Bound.deserialize(note.xywh);
          const edgelessTitleAnchor = Vec.add(noteBound.tl, [
            EDGELESS_BLOCK_CHILD_PADDING,
            12,
          ]);

          const center = Vec.sub(edgelessTitleAnchor, pageTitleAnchor);
          gfx.viewport.setCenter(center[0], center[1]);
          gfx.viewport.smoothZoom(0.65, undefined, 15);

          return true;
        },
  });
}

export function patchForEmbedSyncedDocConfig(reactToLit: ReactToLit) {
  return EmbedSyncedDocConfigExtension({
    edgelessHeader: ({ model, std }) =>
      reactToLit(<EdgelessEmbedSyncedDocHeader model={model} std={std} />),
  });
}
