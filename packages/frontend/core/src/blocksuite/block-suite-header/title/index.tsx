import type { Store } from '@blocksuite/store';
import type { InlineEditProps } from '@notesgraph/component';
import { InlineEdit } from '@notesgraph/component';
import { useGuard } from '@notesgraph/core/components/guard';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { DocService, DocsService } from '@notesgraph/core/modules/doc';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import clsx from 'clsx';
import type { HTMLAttributes } from 'react';
import { useCallback, useSyncExternalStore } from 'react';

import * as styles from './style.css';

export interface BlockSuiteHeaderTitleProps {
  /** if set, title cannot be edited */
  inputHandleRef?: InlineEditProps['handleRef'];
  className?: string;
}

const inputAttrs = {
  'data-testid': 'title-content',
} as HTMLAttributes<HTMLInputElement>;

type TitleText = {
  yText: { observe(f: () => void): void; unobserve(f: () => void): void };
  toString(): string;
};

const rootTitleOf = (store: Store) =>
  (store.root?.props as { title?: TitleText } | undefined)?.title ?? null;

/**
 * The note's title as it is being typed. The workspace meta title, which
 * the rest of the app reads, is only written once typing pauses or the title
 * loses focus. Showing that here made the header widen on that blur, under
 * the pointer of the click that caused it, so the click landed beside the
 * header button it was aimed at.
 */
function useLiveRootTitle(store: Store): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let observed: TitleText | null = null;
      const attach = () => {
        observed?.yText.unobserve(onChange);
        observed = rootTitleOf(store);
        observed?.yText.observe(onChange);
        onChange();
      };
      attach();
      const subscription = store.slots.rootAdded.subscribe(attach);
      return () => {
        subscription.unsubscribe();
        observed?.yText.unobserve(onChange);
      };
    },
    [store]
  );
  return useSyncExternalStore(
    subscribe,
    () => rootTitleOf(store)?.toString() ?? null
  );
}
export const BlocksuiteHeaderTitle = (props: BlockSuiteHeaderTitleProps) => {
  const { inputHandleRef } = props;
  const workspaceService = useService(WorkspaceService);
  const isSharedMode = workspaceService.workspace.openOptions.isSharedMode;
  const docsService = useService(DocsService);
  const docService = useService(DocService);
  const metaTitle = useLiveData(docService.doc.record.title$);
  const docTitle = useLiveRootTitle(docService.doc.blockSuiteDoc) ?? metaTitle;

  const onChange = useAsyncCallback(
    async (v: string) => {
      await docsService.changeDocTitle(docService.doc.id, v);
      track.$.header.actions.renameDoc();
    },
    [docService.doc.id, docsService]
  );

  const canEdit = useGuard('Doc_Update', docService.doc.id);

  return (
    <InlineEdit
      className={clsx(styles.title, props.className)}
      value={docTitle}
      onChange={onChange}
      editable={!isSharedMode && canEdit}
      exitible={true}
      placeholder="Untitled"
      data-testid="title-edit-button"
      handleRef={inputHandleRef}
      inputAttrs={inputAttrs}
    />
  );
};
