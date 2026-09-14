import { PlusIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@notesgraph/component';
import { RenameModal } from '@notesgraph/component/rename-modal';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelProjectNode } from '../../nodes/project';
import { NavigationPanelTreeRoot } from '../../tree';
import { RootEmpty } from './empty';

export const NavigationPanelProjects = () => {
  const { projectsService, navigationPanelService } = useServices({
    ProjectsService,
    NavigationPanelService,
  });
  const path = useMemo(() => ['projects'], []);
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const [creating, setCreating] = useState(false);
  const projects = useLiveData(projectsService.projects.projects$);

  const t = useI18n();

  const handleCreateProject = useCallback(
    (name: string) => {
      projectsService.createProject(name).catch(console.error);
      navigationPanelService.setCollapsed(path, false);
    },
    [navigationPanelService, path, projectsService]
  );

  useEffect(() => {
    if (collapsed) setCreating(false);
  }, [collapsed]);

  const handleOpenCreateModal = useCallback(() => {
    setCreating(true);
  }, []);

  return (
    <CollapsibleSection
      path={path}
      testId="navigation-panel-projects"
      title={t['com.notesgraph.rootAppSidebar.projects']()}
      actions={
        <>
          <IconButton
            data-testid="navigation-panel-bar-add-project-button"
            onClick={handleOpenCreateModal}
            size="16"
            tooltip={t[
              'com.notesgraph.rootAppSidebar.explorer.project-section-add-tooltip'
            ]()}
          >
            <PlusIcon />
          </IconButton>
          {creating && (
            <RenameModal
              open
              onOpenChange={setCreating}
              onRename={handleCreateProject}
              currentName={t['com.notesgraph.rootAppSidebar.projects.new-project']()}
            />
          )}
        </>
      }
    >
      <NavigationPanelTreeRoot placeholder={<RootEmpty />}>
        {(projects ?? []).map(project => (
          <NavigationPanelProjectNode
            key={project.id}
            projectId={project.id}
            reorderable={false}
            parentPath={path}
          />
        ))}
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
