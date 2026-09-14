import { FolderIcon } from '@blocksuite/icons/rc';
import { MenuItem, Modal } from '@notesgraph/component';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback } from 'react';

/**
 * Assigns `docId` to a project — used for both "Move to Project" (docId is
 * the doc's own id) and "Copy to Project" (the caller in the doc `...` menu
 * duplicates the doc first via the existing same-workspace duplicate
 * helper, then opens this dialog with the new doc's id).
 */
export const AddToProjectDialog = ({
  docId,
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['add-to-project']>) => {
  const t = useI18n();
  const projectsService = useService(ProjectsService);
  const projects = useLiveData(projectsService.projects.projects$);

  const handleSelect = useCallback(
    (projectId: string) => {
      projectsService
        .assignDocToProject(docId, projectId)
        .catch(console.error);
      close();
    },
    [close, docId, projectsService]
  );

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) close();
      }}
      width={360}
      title={t['com.notesgraph.projects.add-to-project.title']()}
    >
      {(projects ?? []).length === 0 ? (
        <div>{t['com.notesgraph.projects.add-to-project.empty']()}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {(projects ?? []).map(project => (
            <MenuItem
              key={project.id}
              prefixIcon={<FolderIcon />}
              onClick={() => handleSelect(project.id)}
            >
              {project.name}
            </MenuItem>
          ))}
        </div>
      )}
    </Modal>
  );
};
