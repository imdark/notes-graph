import { openAssignToAgentMenuOn } from '@notesgraph/core/blocksuite/view-extensions/agents/assign-widget';
import type { Editor } from '@notesgraph/core/modules/editor';
import { ViewService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useRef, useState } from 'react';

/**
 * `?assignAgent=<blockId>` on a note's URL: open the note with that line's
 * assign-to-agent menu up, as if its pill were clicked. The capture window
 * hands a capture to an agent this way, so the run starts here, where the
 * Agents panel can show it.
 */
export const ASSIGN_AGENT_PARAM = 'assignAgent';

export function useAssignAgentFromUrl(editor: Editor) {
  const view = useService(ViewService).view;
  // Read once: the editor rewrites the query string as it syncs its params.
  const [blockId] = useState(() =>
    new URLSearchParams(view.location$.value.search).get(ASSIGN_AGENT_PARAM)
  );
  const editorContainer = useLiveData(editor.editorContainer$);
  const opened = useRef(false);

  useEffect(() => {
    if (!blockId) return;
    // Going back to the note must not open the menu again.
    view.updateQueryString(
      { [ASSIGN_AGENT_PARAM]: undefined },
      { replace: true }
    );
  }, [blockId, view]);

  useEffect(() => {
    const std = editorContainer?.std;
    if (!blockId || !std || opened.current) return;
    const controller = new AbortController();
    openAssignToAgentMenuOn(std, blockId, controller.signal)
      .then(shown => {
        if (shown) opened.current = true;
      })
      .catch(console.error);
    return () => controller.abort();
  }, [blockId, editorContainer]);
}
