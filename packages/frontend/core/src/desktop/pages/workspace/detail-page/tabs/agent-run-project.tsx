import { notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunsStore,
  RemoteAgentRunnerService,
  TaskProjectService,
} from '@notesgraph/core/modules/agents';
import {
  type Project,
  ProjectsService,
} from '@notesgraph/core/modules/projects';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './agents.css';

/** The select's value for Inbox; no project id is empty. */
const INBOX_VALUE = '';

/**
 * What a run still going is told when its task moves, so it doesn't file
 * the task back under the project it was started in.
 */
export const projectMovedSteer = (
  project: Pick<Project, 'id' | 'name'> | null
) =>
  project
    ? `The task you are working on was moved to the project "${project.name}" (projectId: ${project.id}). It is that project's task now; leave it under that project's section.`
    : "The task you are working on was moved out of its project into the Inbox. Leave it there; don't file it back under a project.";

/**
 * The task's project for a run on a block or a selection, as a dropdown that
 * moves the task into another one. A run still going on a device is told of
 * the move. Nothing for a run on a whole note (in a project by being one of
 * its notes) or whose blocks are gone.
 */
export const AgentRunProject = ({ run }: { run: AgentRun }) => {
  const runsStore = useService(AgentRunsStore);
  const taskProject = useService(TaskProjectService);
  const projectsService = useService(ProjectsService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const projects = useLiveData(projectsService.projects.projects$);
  useEffect(() => {
    if (!projects) projectsService.projects.revalidate().catch(() => {});
  }, [projects, projectsService]);

  const target = useMemo(() => runsStore.targetOf(run), [run, runsStore]);
  const [current, setCurrent] = useState<{
    projectId: string | null | undefined;
    inboxable: boolean;
  } | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    setCurrent(null);
    if (!target || target.kind === 'doc' || !projects) return;
    let cancelled = false;
    taskProject
      .read(target, projects)
      .then(read => !cancelled && setCurrent(read))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projects, target, taskProject]);

  const sorted = useMemo(
    () =>
      [...(projects ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    [projects]
  );

  const onChange = useCallback(
    (value: string) => {
      if (!target || !current) return;
      const project =
        value === INBOX_VALUE
          ? null
          : (sorted.find(project => project.id === value) ?? null);
      if (value !== INBOX_VALUE && !project) return;
      setMoving(true);
      taskProject
        .move(target, project)
        .then(async moved => {
          if (!moved) throw new Error('Its blocks are no longer in the note.');
          setCurrent({ ...current, projectId: project?.id ?? null });
          notify.success({
            title: `Moved to ${project ? project.name : 'Inbox'}`,
          });
          if (run.status === 'running' && run.remoteJobId) {
            await remoteRunner
              .steer(
                workspaceService.workspace.id,
                run.remoteJobId,
                projectMovedSteer(project)
              )
              .catch(err =>
                notify.error({
                  title: "Moved it, but couldn't tell the run",
                  message: err instanceof Error ? err.message : String(err),
                })
              );
          }
        })
        .catch(err =>
          notify.error({
            title: "Couldn't move the task",
            message: err instanceof Error ? err.message : String(err),
          })
        )
        .finally(() => setMoving(false));
    },
    [current, remoteRunner, run, sorted, target, taskProject, workspaceService]
  );

  if (!current || current.projectId === undefined) return null;
  // A task out of every section of a project's own note is still that
  // project's, so Inbox is no place it can be moved to there.
  const showInbox = current.inboxable || current.projectId === null;

  return (
    <label className={styles.projectRow} data-testid="agent-run-project">
      <span className={styles.hint}>Project</span>
      <select
        className={styles.projectSelect}
        value={current.projectId ?? INBOX_VALUE}
        disabled={moving}
        onChange={e => onChange(e.target.value)}
        // Inside the block's runs menu, typed letters would otherwise move
        // focus to a menu item; Escape still closes it.
        onKeyDown={e => e.key !== 'Escape' && e.stopPropagation()}
        data-testid="agent-run-project-select"
      >
        {showInbox ? <option value={INBOX_VALUE}>Inbox</option> : null}
        {sorted.map(project => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
};
