/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { AGENT_TEMPLATES } from './agent-templates';
import { MIN_INTERVAL_MINUTES } from './monitors';
import {
  isNotesHealthMonitor,
  NOTES_HEALTH_INSTRUCTIONS,
  NOTES_HEALTH_TEMPLATE,
  notesHealthDevice,
  notesHealthMonitorDraft,
  WEEK_MINUTES,
} from './notes-health';
import { CLOUD_DEVICE_KEY, editorHarness } from './remote-runner';

describe('notes health check', () => {
  test('is offered among the agent templates, on the server runner', () => {
    expect(AGENT_TEMPLATES).toContain(NOTES_HEALTH_TEMPLATE);
    const { draft } = NOTES_HEALTH_TEMPLATE;
    expect(editorHarness(draft.harness, draft.model, draft.deviceKey)).toBe(
      'cloud'
    );
  });

  test('covers every check and only reports, through the deterministic tool', () => {
    for (const check of [
      'notes_health',
      'orphans',
      'broken links',
      'Duplicates page',
      'stale',
      'contradictions',
      'stubs',
      '- [ ]',
    ]) {
      expect(NOTES_HEALTH_INSTRUCTIONS).toContain(check);
    }
    expect(NOTES_HEALTH_INSTRUCTIONS).toMatch(/never edit, merge/);
  });

  test('the monitor runs weekly as an agent and always tells the person', () => {
    const draft = notesHealthMonitorDraft('doc1', 'block1', CLOUD_DEVICE_KEY);
    expect(draft).toMatchObject({
      kind: 'agent',
      source: null,
      docId: 'doc1',
      blockId: 'block1',
      deviceKey: CLOUD_DEVICE_KEY,
      intervalMinutes: WEEK_MINUTES,
      condition: { type: 'always' },
      alerts: { inApp: true },
    });
    expect(draft.spec.instructions).toBe(NOTES_HEALTH_INSTRUCTIONS);
    expect(draft.intervalMinutes).toBeGreaterThanOrEqual(
      MIN_INTERVAL_MINUTES.agent
    );
    expect(isNotesHealthMonitor(draft)).toBe(true);
    expect(isNotesHealthMonitor({ ...draft, kind: 'check' })).toBe(false);
  });

  test('prefers the cloud runner, else the first device, else nothing', () => {
    expect(notesHealthDevice([{ key: 'mac' }, { key: CLOUD_DEVICE_KEY }])).toBe(
      CLOUD_DEVICE_KEY
    );
    expect(notesHealthDevice([{ key: 'mac' }, { key: 'pc' }])).toBe('mac');
    expect(notesHealthDevice([])).toBeNull();
  });
});
