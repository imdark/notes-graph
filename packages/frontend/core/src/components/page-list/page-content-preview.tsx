import { DocSummaryService } from '@notesgraph/core/modules/doc-summary';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { type ReactNode, useMemo } from 'react';

interface PagePreviewProps {
  pageId: string;
  emptyFallback?: ReactNode;
  fallback?: ReactNode;
}

// Doc summaries can carry line breaks from the source content (a soft return
// within a block, or blocks concatenated with no separator). Card previews
// (search results, recent list) are single/few-line and truncate with
// text-overflow, so a raw line break renders as a stray early wrap instead of
// contributing to the truncation — collapse all whitespace runs to a single
// space, same as the title-normalizing helpers elsewhere in this codebase.
function toSingleLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

const PagePreviewInner = ({
  pageId,
  emptyFallback,
  fallback,
}: PagePreviewProps) => {
  const docSummary = useService(DocSummaryService);
  const summary = useLiveData(
    useMemo(
      () => LiveData.from(docSummary.watchDocSummary(pageId), null),
      [docSummary, pageId]
    )
  );

  const res = !summary
    ? summary === ''
      ? emptyFallback
      : fallback
    : toSingleLine(summary);
  return res;
};

export const PagePreview = (props: PagePreviewProps) => {
  return <PagePreviewInner {...props} />;
};
