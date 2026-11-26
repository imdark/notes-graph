/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { projectMovedSteer } from './agent-run-project';

describe('projectMovedSteer', () => {
  test('names the project and its id, so the run can file the task there', () => {
    const steer = projectMovedSteer({ id: 'p-ng', name: 'notes graph' });
    expect(steer).toContain('"notes graph"');
    expect(steer).toContain('projectId: p-ng');
  });

  test('Inbox says not to file it back under a project', () => {
    expect(projectMovedSteer(null)).toContain('into the Inbox');
  });
});
