import { Button } from '@notesgraph/component';
import { useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import { DocEmbedder, type RelatedDoc } from '../services/doc-embedder';

/**
 * Right-sidebar panel that surfaces other notes related to the current one, by
 * on-device embedding similarity (reuses the local vector index). The "button
 * within the note" is the sidebar tab that opens this. Title lookup + open are
 * passed in so this view doesn't depend on other modules (avoids import cycles).
 */
export const RelatedDocsPanel = ({
  docId,
  getDocTitle,
  onOpenDoc,
}: {
  docId: string;
  getDocTitle: (docId: string) => string;
  onOpenDoc: (docId: string) => void;
}) => {
  const docEmbedder = useService(DocEmbedder);
  const [related, setRelated] = useState<RelatedDoc[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    docEmbedder
      .findRelatedDocs(docId, 8)
      .then(setRelated)
      .catch(() => setRelated([]))
      .finally(() => setLoading(false));
  }, [docEmbedder, docId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      style={{
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 600 }}>Related notes</span>
        <Button variant="plain" loading={loading} onClick={load}>
          Refresh
        </Button>
      </div>

      {related && related.length === 0 && !loading ? (
        <div
          style={{
            color: 'var(--notesgraph-text-secondary-color)',
            fontSize: 13,
          }}
        >
          No related notes found. Make sure your documents are indexed in
          Settings → On-device AI → Document index.
        </div>
      ) : null}

      {related?.map(item => (
        <div
          key={item.docId}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDoc(item.docId)}
          onKeyDown={event => {
            if (event.key === 'Enter') onOpenDoc(item.docId);
          }}
          style={{
            cursor: 'pointer',
            padding: 8,
            borderRadius: 8,
            border: '1px solid var(--notesgraph-border-color)',
          }}
        >
          <div
            style={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {getDocTitle(item.docId)}
          </div>
          <div
            style={{
              color: 'var(--notesgraph-text-secondary-color)',
              fontSize: 12,
              marginTop: 2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.snippet}
          </div>
        </div>
      ))}
    </div>
  );
};
