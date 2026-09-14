import { PropertyCollapsibleSection } from '@notesgraph/component';
import { NotesGraphPageReference } from '@notesgraph/core/components/notesgraph/reference-link';
import type { Backlink, Link } from '@notesgraph/core/modules/doc-link';
import type { MouseEvent, ReactNode } from 'react';

import * as styles from './links-row.css';

export const LinksRow = ({
  references,
  count,
  label,
  className,
  onClick,
}: {
  references: Backlink[] | Link[] | ReactNode;
  count: number;
  label: string;
  className?: string;
  onClick?: (e: MouseEvent) => void;
}) => {
  return (
    <PropertyCollapsibleSection
      title={`${label} · ${count}`}
      className={className}
    >
      {Array.isArray(references)
        ? references.map(link => (
            <NotesGraphPageReference
              key={link.docId}
              pageId={link.docId}
              params={'params' in link ? link.params : undefined}
              className={styles.wrapper}
              onClick={onClick}
            />
          ))
        : references}
    </PropertyCollapsibleSection>
  );
};
