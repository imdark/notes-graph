import { DeleteIcon, FolderIcon, MemberIcon } from '@blocksuite/icons/rc';
import { MenuItem, MenuSeparator, toast } from '@notesgraph/component';
import { RenameModal } from '@notesgraph/component/rename-modal';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService, useServices } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { NavigationPanelTreeNode } from '../../tree';
import type { NodeOperation } from '../../tree/types';
import { NavigationPanelDocNode } from '../doc';
import type { GenericNavigationPanelNode } from '../types';

export const NavigationPanelProjectNode = ({
  projectId,
  reorderable,
  parentPath,
}: {
  projectId: string;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const { projectsService, workspaceDialogService, workspaceService } =
    useServices({
      ProjectsService,
      WorkspaceDialogService,
      WorkspaceService,
    });
  const navigationPanelService = useService(NavigationPanelService);
  const [renaming, setRenaming] = useState(false);
  // Member sharing requires the server; local workspaces group docs only.
  const supportsMembers = workspaceService.workspace.flavour !== 'local';

  const projects = useLiveData(projectsService.projects.projects$);
  const project = useMemo(
    () => projects?.find(p => p.id === projectId),
    [projects, projectId]
  );

  const path = useMemo(
    () => [...(parentPath ?? []), `project-${projectId}`],
    [parentPath, projectId]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );

  const handleRename = useCallback(
    (newName: string) => {
      projectsService.renameProject(projectId, newName).catch(console.error);
    },
    [projectId, projectsService]
  );

  const handleDelete = useCallback(() => {
    projectsService.deleteProject(projectId).catch(console.error);
    toast(t['com.notesgraph.projects.delete-project.toast']());
  }, [projectId, projectsService, t]);

  const handleManageMembers = useCallback(() => {
    workspaceDialogService.open('project-members', { projectId });
  }, [projectId, workspaceDialogService]);

  const operations = useMemo<NodeOperation[]>(
    () => [
      {
        index: 50,
        view: (
          <MenuItem onClick={() => setRenaming(true)}>{t['Rename']()}</MenuItem>
        ),
      },
      ...(supportsMembers
        ? [
            {
              index: 60,
              view: (
                <MenuItem
                  prefixIcon={<MemberIcon />}
                  onClick={handleManageMembers}
                  data-testid="project-manage-members-button"
                >
                  {t['com.notesgraph.projects.manage-members']()}
                </MenuItem>
              ),
            },
          ]
        : []),
      {
        index: 9999,
        view: <MenuSeparator key="menu-separator" />,
      },
      {
        index: 10000,
        view: (
          <MenuItem
            type="danger"
            prefixIcon={<DeleteIcon />}
            onClick={handleDelete}
            data-testid="project-delete-button"
          >
            {t['Delete']()}
          </MenuItem>
        ),
      },
    ],
    [handleDelete, handleManageMembers, supportsMembers, t]
  );

  if (!project) {
    return null;
  }

  return (
    <NavigationPanelTreeNode
      icon={FolderIcon}
      name={project.name}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      reorderable={reorderable}
      operations={operations}
      data-testid={`navigation-panel-project-${projectId}`}
    >
      {renaming && (
        <RenameModal
          open
          onOpenChange={setRenaming}
          onRename={handleRename}
          currentName={project.name}
        />
      )}
      {project.docIds.map(docId => (
        <NavigationPanelDocNode
          key={docId}
          docId={docId}
          reorderable={false}
          parentPath={path}
        />
      ))}
    </NavigationPanelTreeNode>
  );
};
