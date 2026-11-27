import { notify } from '@notesgraph/component';
import {
  getAIRequestService,
  hasAIRequestService,
} from '@notesgraph/core/blocksuite/ai/runtime/request/provider';
import { useGuard } from '@notesgraph/core/components/guard';
import { storeMarkdown } from '@notesgraph/core/modules/agents/services/context';
import { AiBackendService } from '@notesgraph/core/modules/ai-local';
import { DocsService } from '@notesgraph/core/modules/doc';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useState } from 'react';

import { useAsyncCallback } from '../notesgraph-async-hooks';
import { cleanGeneratedTitle, TITLE_SOURCE_CHARS } from './generated-title';
import { useEnableAI } from './use-enable-ai';

/**
 * The "Generate title" item on a note's … menu: offered while the note has
 * no title, it has the AI the user picked (cloud or on-device) read the note
 * and name it.
 */
export function useGenerateDocTitle(docId: string | undefined) {
  const docsService = useService(DocsService);
  const workspaceService = useService(WorkspaceService);
  const flags = useService(FeatureFlagService).flags;
  const enabled = useLiveData(flags.enable_generate_note_title.$);
  const backend = useLiveData(useService(AiBackendService).backend$);
  const cloudAI = useEnableAI();
  const record = useLiveData(docId ? docsService.list.doc$(docId) : null);
  const title = useLiveData(record?.title$) ?? '';
  const canEdit = useGuard('Doc_Update', docId ?? '');
  const [generating, setGenerating] = useState(false);

  const available =
    !!enabled &&
    !!record &&
    !title.trim() &&
    !!canEdit &&
    (backend === 'local' || !!cloudAI);

  const generate = useAsyncCallback(async () => {
    if (!docId || generating) return;
    if (!hasAIRequestService()) {
      notify.error({ title: 'AI is still starting. Try again in a moment.' });
      return;
    }
    setGenerating(true);
    const { doc, release } = docsService.open(docId);
    try {
      await doc.waitForSyncReady();
      const markdown = (await storeMarkdown(doc.blockSuiteDoc)).trim();
      if (!markdown) {
        notify({ title: 'This note is empty, so there is nothing to title.' });
        return;
      }
      const stream = await getAIRequestService().executeAction(
        'generateTitle',
        {
          input: markdown.slice(0, TITLE_SOURCE_CHARS),
          workspaceId: workspaceService.workspace.id,
          docId,
          stream: true,
        }
      );
      let reply = '';
      for await (const chunk of stream) reply += chunk;
      const generated = cleanGeneratedTitle(reply);
      if (!generated) {
        notify.error({ title: 'The AI did not suggest a title.' });
        return;
      }
      // The user may have typed one while the model was answering.
      if (doc.title$.value.trim()) return;
      doc.changeDocTitle(generated);
      notify.success({ title: `Titled “${generated}”` });
    } catch (error) {
      notify.error({
        title: 'Could not generate a title',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      release();
      setGenerating(false);
    }
  }, [docId, docsService, generating, workspaceService]);

  return { available, generating, generate };
}
