import { createIdentifier } from '@blocksuite/global/di';
import type { Observable } from 'rxjs';

/**
 * A project as the editor sees it: an id, a display name, and the set of
 * docs that belong to it. Mirrors the app's local/cloud `Project` shape,
 * narrowed to what an in-editor query needs.
 */
export interface ProjectInfo {
  id: string;
  name: string;
  docIds: string[];
}

/**
 * Optional extension point giving editor code the workspace's project list
 * (for the Task Query block's project picker and for resolving a project to
 * its member docs). No default implementation is registered; look it up via
 * `std.getOptional(ProjectsProvider)` — a missing provider means the host
 * app has no projects concept.
 */
export interface ProjectsService {
  /** Live list of the workspace's projects; re-emits as projects change. */
  projects$(): Observable<ProjectInfo[]>;
}

export const ProjectsProvider = createIdentifier<ProjectsService>(
  'NotesGraphProjectsService'
);
