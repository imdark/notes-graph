import { AddOrganizeIcon } from '@blocksuite/icons/rc';
import { NavigationPanelTreeRoot } from '@notesgraph/core/desktop/components/navigation-panel';
import { NavigationPanelProjectNode } from '@notesgraph/core/desktop/components/navigation-panel/nodes/project';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import { AddItemPlaceholder } from '../../layouts/add-item-placeholder';
import { CollapsibleSection } from '../../layouts/collapsible-section';

export const NavigationPanelProjects = () => {
  const { projectsService, navigationPanelService } = useServices({
    ProjectsService,
    NavigationPanelService,
  });
  const path = useMemo(() => ['projects'], []);
  const projects = useLiveData(projectsService.projects.projects$);
  const t = useI18n();

  const handleCreateProject = useCallback(() => {
    const name = t['com.notesgraph.rootAppSidebar.projects.new-project']();
    projectsService.createProject(name).catch(console.error);
    navigationPanelService.setCollapsed(path, false);
  }, [navigationPanelService, path, projectsService, t]);

  return (
    <CollapsibleSection
      path={path}
      title={t['com.notesgraph.rootAppSidebar.projects']()}
    >
      <NavigationPanelTreeRoot>
        {(projects ?? []).map(project => (
          <NavigationPanelProjectNode
            key={project.id}
            projectId={project.id}
            reorderable={false}
            parentPath={path}
          />
        ))}
        <AddItemPlaceholder
          icon={<AddOrganizeIcon />}
          data-testid="navigation-panel-bar-add-project-button"
          label={t['com.notesgraph.rootAppSidebar.projects.new-project']()}
          onClick={handleCreateProject}
        />
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
