import { Button, Checkbox, Input, Loading, Modal, notify } from '@notesgraph/component';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { firstValueFrom } from 'rxjs';

import * as styles from './index.css';

interface RelatedDoc {
  docId: string;
  title: string;
}

export const ConvertToProjectDialog = ({
  docId,
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['convert-to-project']>) => {
  const t = useI18n();
  const { docsService, docsSearchService, projectsService } = useServices({
    DocsService,
    DocsSearchService,
    ProjectsService,
  });

  const docRecord = useLiveData(docsService.list.doc$(docId));
  const docTitle = useLiveData(docRecord?.title$) ?? '';

  const [name, setName] = useState('');
  const [related, setRelated] = useState<RelatedDoc[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (docTitle && !name) {
      setName(
        t['com.notesgraph.projects.convert-to-project.default-name']({
          title: docTitle,
        })
      );
    }
    // Only seed the default once, when the doc's title first resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTitle]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      firstValueFrom(docsSearchService.watchRefsFrom(docId)),
      firstValueFrom(docsSearchService.watchBacklinksFrom(docId)),
    ])
      .then(([links, backlinks]) => {
        if (cancelled) return;
        const byId = new Map<string, RelatedDoc>();
        for (const link of [...links, ...backlinks]) {
          if (link.docId === docId) continue;
          byId.set(link.docId, { docId: link.docId, title: link.title });
        }
        const list = Array.from(byId.values());
        setRelated(list);
        setSelected(new Set(list.map(item => item.docId)));
      })
      .catch(error => {
        console.error('Failed to load related docs', error);
        setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docId, docsSearchService]);

  const handleToggle = useCallback((relatedDocId: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(relatedDocId);
      } else {
        next.delete(relatedDocId);
      }
      return next;
    });
  }, []);

  const trimmedName = useMemo(() => name.trim(), [name]);

  const handleConfirm = useCallback(async () => {
    if (!trimmedName) return;
    setSubmitting(true);
    try {
      await projectsService.convertDocToProject(
        trimmedName,
        docId,
        Array.from(selected)
      );
      close();
    } catch (error) {
      console.error('Failed to convert doc to project', error);
      notify.error({
        title: t['com.notesgraph.projects.convert-to-project.error'](),
      });
    } finally {
      setSubmitting(false);
    }
  }, [close, docId, projectsService, selected, t, trimmedName]);

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) close();
      }}
      width={420}
      title={t['com.notesgraph.projects.convert-to-project.title']()}
    >
      <div className={styles.body}>
        <label className={styles.label}>
          {t['com.notesgraph.projects.convert-to-project.name-label']()}
        </label>
        <Input value={name} onChange={setName} autoFocus />

        <div className={styles.label}>
          {t['com.notesgraph.projects.convert-to-project.related-label']()}
        </div>
        {related === null ? (
          <Loading />
        ) : related.length === 0 ? (
          <div className={styles.empty}>
            {t['com.notesgraph.projects.convert-to-project.no-related']()}
          </div>
        ) : (
          <div className={styles.list}>
            {related.map(item => (
              <Checkbox
                key={item.docId}
                label={item.title || t['Untitled']()}
                checked={selected.has(item.docId)}
                onChange={(_, checked) => handleToggle(item.docId, checked)}
              />
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <Button onClick={() => close()}>
            {t['com.notesgraph.confirmModal.button.cancel']()}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={!trimmedName}
            loading={submitting}
          >
            {t['com.notesgraph.projects.convert-to-project.confirm']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
