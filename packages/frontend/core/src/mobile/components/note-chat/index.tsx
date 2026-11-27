import { CloseIcon } from '@blocksuite/icons/rc';
import { IconButton, Modal } from '@notesgraph/component';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useLiveData, useService } from '@notesgraph/infra';
import { lazy, Suspense } from 'react';

import * as styles from './sheet.css';

// The chat pulls in the AI runtime, so it loads when the sheet first opens.
const EditorChatPanel = lazy(() =>
  import('@notesgraph/core/desktop/pages/workspace/detail-page/tabs/chat').then(
    module => ({ default: module.EditorChatPanel })
  )
);

/**
 * The note's AI chat on a phone. A desktop window has it in the side panel;
 * here it takes the whole screen, over the note it is about. It is the same
 * chat with the same history: closing the sheet and opening it again goes on
 * with the conversation.
 */
export const NoteChatSheet = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const editor = useService(EditorService).editor;
  const editorContainer = useLiveData(editor.editorContainer$);

  return (
    <Modal
      fullScreen
      open={open}
      onOpenChange={onOpenChange}
      animation="slideBottom"
      withoutCloseButton
      contentOptions={{ className: styles.sheet }}
    >
      <div className={styles.header}>
        <span className={styles.title}>Chat</span>
        <IconButton
          size="24"
          icon={<CloseIcon />}
          aria-label="Close chat"
          data-testid="note-chat-close"
          onClick={() => onOpenChange(false)}
        />
      </div>
      <div className={styles.body} data-testid="note-chat-sheet">
        <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
          <EditorChatPanel
            editor={editorContainer}
            doc={editor.doc.blockSuiteDoc}
          />
        </Suspense>
      </div>
    </Modal>
  );
};
