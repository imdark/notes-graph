/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { AGENT_TEMPLATES, DEAL_MONITOR_TEMPLATE } from './agent-templates';
import { editorHarness } from './remote-runner';

describe('agent templates', () => {
  test('deal monitor runs as a research worker on the server runner', () => {
    const { draft } = DEAL_MONITOR_TEMPLATE;
    expect(draft.kind).toBe('worker');
    expect(editorHarness(draft.harness, draft.model, draft.deviceKey)).toBe(
      'cloud'
    );
    expect(draft.instructions).toContain('RTX 5090');
    expect(draft.instructions).toContain('$4000');
  });

  test('template ids are unique', () => {
    const ids = AGENT_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
