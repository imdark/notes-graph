import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocLinksService } from '@notesgraph/core/modules/doc-link';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useEffect } from 'react';

/**
 * A small "N backlinks" chip in the doc header that surfaces how connected the
 * current doc is — emphasizing the relational nature of NotesGraph. Hidden when
 * there are no backlinks. Clicking opens the doc-info panel, which lists them.
 */
export const BacklinksButton = ({ docId }: { docId: string }) => {
  const t = useI18n();
  const docLinksService = useService(DocLinksService);
  const workspaceDialogService = useService(WorkspaceDialogService);
  const backlinks = useLiveData(docLinksService.backlinks.backlinks$);

  useEffect(() => {
    docLinksService.backlinks.revalidateFromCloud();
  }, [docLinksService.backlinks]);

  const onClick = useCallback(() => {
    workspaceDialogService.open('doc-info', { docId });
  }, [docId, workspaceDialogService]);

  const count = backlinks?.length ?? 0;
  if (count === 0) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="header-backlinks-button"
      title={t['com.notesgraph.page-properties.backlinks']()}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        padding: '0 8px',
        marginRight: 4,
        borderRadius: 12,
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        color: cssVarV2('text/emphasis'),
        backgroundColor: 'rgba(34, 211, 238, 0.12)',
      }}
    >
      {/* a mini two-node edge — a single relationship */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M5 9L9 5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="3.5" cy="10.5" r="2" fill="currentColor" />
        <circle cx="10.5" cy="3.5" r="2" fill="currentColor" />
      </svg>
      {count}
    </button>
  );
};
