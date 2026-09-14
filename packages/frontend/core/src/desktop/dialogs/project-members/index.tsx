import { Avatar, Button, Modal } from '@notesgraph/component';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { WorkspaceMembersService } from '@notesgraph/core/modules/permissions';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useEffect, useMemo } from 'react';

export const ProjectMembersDialog = ({
  projectId,
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['project-members']>) => {
  const t = useI18n();
  const { projectsService, workspaceMembersService } = useServices({
    ProjectsService,
    WorkspaceMembersService,
  });

  const projects = useLiveData(projectsService.projects.projects$);
  const project = useMemo(
    () => projects?.find(p => p.id === projectId),
    [projects, projectId]
  );
  const memberUserIds = useMemo(
    () => new Set(project?.members.map(m => m.userId) ?? []),
    [project]
  );

  const workspaceMembers = useLiveData(workspaceMembersService.members.pageMembers$);

  useEffect(() => {
    workspaceMembersService.members.revalidate();
  }, [workspaceMembersService]);

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) close();
      }}
      width={480}
      title={t['com.notesgraph.projects.members.title']({
        name: project?.name ?? '',
      })}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(workspaceMembers ?? []).map(member => {
          const isMember = memberUserIds.has(member.id);
          return (
            <div
              key={member.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar url={member.avatarUrl ?? undefined} name={member.name} size={24} />
                <span>{member.name || member.email}</span>
              </div>
              <Button
                onClick={() => {
                  if (isMember) {
                    projectsService
                      .removeProjectMember(projectId, member.id)
                      .catch(console.error);
                  } else {
                    projectsService
                      .addProjectMember(projectId, member.id)
                      .catch(console.error);
                  }
                }}
              >
                {isMember
                  ? t['com.notesgraph.projects.members.remove']()
                  : t['com.notesgraph.projects.members.add']()}
              </Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
