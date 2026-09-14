import { Button, Modal, notify } from '@notesgraph/component';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './index.css';

export const LinkVisibilityConfirmDialog = ({
  sourceDocId,
  targetDocId,
  close,
}: DialogComponentProps<
  WORKSPACE_DIALOG_SCHEMA['link-visibility-confirm']
>) => {
  const t = useI18n();
  const { docsService, projectsService, workspaceDialogService } =
    useServices({
      DocsService,
      ProjectsService,
      WorkspaceDialogService,
    });

  const projects = useLiveData(projectsService.projects.projects$);
  const sourceTitle =
    useLiveData(docsService.list.doc$(sourceDocId))?.title$.value;
  const targetTitle =
    useLiveData(docsService.list.doc$(targetDocId))?.title$.value;

  const [undoing, setUndoing] = useState(false);
  const [applying, setApplying] = useState(false);

  const { affectedDocId, affectedTitle, otherTitle, suggestedProject } =
    useMemo(() => {
      const sourceProject = (projects ?? []).find(p =>
        p.docIds.includes(sourceDocId)
      );
      const targetProject = (projects ?? []).find(p =>
        p.docIds.includes(targetDocId)
      );
      if (targetProject && !sourceProject) {
        return {
          affectedDocId: sourceDocId,
          affectedTitle: sourceTitle,
          otherTitle: targetTitle,
          suggestedProject: targetProject,
        };
      }
      // Covers both "source is in a project, target isn't" (suggest adding
      // target to source's project) and "both are in different projects"
      // (defaults to the same direction — "Change project" lets the user
      // pick differently).
      return {
        affectedDocId: targetDocId,
        affectedTitle: targetTitle,
        otherTitle: sourceTitle,
        suggestedProject: sourceProject,
      };
    }, [projects, sourceDocId, targetDocId, sourceTitle, targetTitle]);

  const handleConfirm = useCallback(async () => {
    if (!suggestedProject) return;
    setApplying(true);
    try {
      await projectsService.assignDocToProject(
        affectedDocId,
        suggestedProject.id
      );
      close();
    } catch (error) {
      console.error('Failed to update project membership', error);
      notify.error({
        title: t['com.notesgraph.projects.link-visibility.apply-error'](),
      });
    } finally {
      setApplying(false);
    }
  }, [affectedDocId, close, projectsService, suggestedProject, t]);

  const handleChangeProject = useCallback(() => {
    close();
    workspaceDialogService.open('add-to-project', { docId: affectedDocId });
  }, [affectedDocId, close, workspaceDialogService]);

  const handleUndo = useCallback(async () => {
    setUndoing(true);
    try {
      await docsService.removeLinkedDoc(sourceDocId, targetDocId);
      close();
    } catch (error) {
      console.error('Failed to undo link', error);
      notify.error({
        title: t['com.notesgraph.projects.link-visibility.undo-error'](),
      });
    } finally {
      setUndoing(false);
    }
  }, [close, docsService, sourceDocId, targetDocId, t]);

  if (!suggestedProject) {
    return null;
  }

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) close();
      }}
      width={420}
      title={t['com.notesgraph.projects.link-visibility.title']()}
    >
      <div className={styles.body}>
        <p className={styles.description}>
          {t['com.notesgraph.projects.link-visibility.description']({
            affected: affectedTitle || t['Untitled'](),
            other: otherTitle || t['Untitled'](),
            project: suggestedProject.name,
          })}
        </p>
        <div className={styles.actions}>
          <Button
            onClick={() => void handleUndo()}
            loading={undoing}
            disabled={applying}
          >
            {t['com.notesgraph.projects.link-visibility.undo']()}
          </Button>
          <Button onClick={handleChangeProject} disabled={undoing || applying}>
            {t['com.notesgraph.projects.link-visibility.change-project']()}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            loading={applying}
            disabled={undoing}
          >
            {t['com.notesgraph.projects.link-visibility.confirm']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
