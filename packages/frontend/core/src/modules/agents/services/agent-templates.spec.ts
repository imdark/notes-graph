/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import {
  AGENT_TEMPLATES,
  COMPILE_SOURCE_TEMPLATE,
  DEAL_MONITOR_TEMPLATE,
} from './agent-templates';
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

  test('compile runs on a whole note on the server runner, without research skills', () => {
    const { draft } = COMPILE_SOURCE_TEMPLATE;
    expect(draft.kind).toBe('worker');
    expect(draft.targets).toEqual(['doc']);
    expect(draft.skills).toEqual([]);
    expect(editorHarness(draft.harness, draft.model, draft.deviceKey)).toBe(
      'cloud'
    );
    expect(draft.instructions).toContain('link_document');
    expect(draft.instructions).toContain('Conflict:');
  });

  test('template ids are unique', () => {
    const ids = AGENT_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
