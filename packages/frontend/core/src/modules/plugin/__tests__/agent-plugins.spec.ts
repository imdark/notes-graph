import { parseManifest } from '@notesgraph/plugin-sdk';
import { describe, expect, test } from 'vitest';

import { type AgentPluginEntry, agentPluginUrl } from '../agent-plugins';

// What the server's AgentPluginModel.save writes (models/agent-plugin.ts).
const served = {
  id: 'agent.word-count',
  name: 'Word count',
  version: '1.0.2',
  description: 'Counts words',
  author: 'claude-opus-5-5',
  platforms: ['web', 'desktop', 'mobile'],
  permissions: ['ui', 'docs'],
  entry: { client: 'index.js?v=1.0.2' },
};

describe('agent plugins', () => {
  test('the manifest the server serves passes the strict schema', () => {
    expect(parseManifest(served).entry.client).toBe('index.js?v=1.0.2');
  });

  test('the load url is absolute against the workspace server', () => {
    const entry = {
      baseUrl: '/api/agent-plugins/tok',
    } as AgentPluginEntry;
    expect(agentPluginUrl(entry, 'https://app.notesgraph.com')).toBe(
      'https://app.notesgraph.com/api/agent-plugins/tok'
    );
    expect(agentPluginUrl(entry, 'http://localhost:3010/')).toBe(
      'http://localhost:3010/api/agent-plugins/tok'
    );
  });
});
