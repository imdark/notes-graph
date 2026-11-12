import test from 'ava';

import type { PromptMessage } from '../../copilot/providers/types';
import {
  type AgentHeadroom,
  type HeadroomSettings,
  routeThroughHeadroom,
  steerTerse,
  TERSE_STEERING,
  withHeadroom,
} from '../index';

const off: HeadroomSettings = {
  copilot: false,
  proxyUrl: 'http://127.0.0.1:8787',
  agentRuns: false,
  terseResponses: false,
};
const on: HeadroomSettings = {
  copilot: true,
  proxyUrl: 'http://headroom:8787/',
  agentRuns: true,
  terseResponses: true,
};

test('official Anthropic and OpenAI calls go through the proxy', t => {
  t.deepEqual(
    routeThroughHeadroom(
      'anthropic',
      { base_url: 'https://api.anthropic.com', auth_token: 'k' },
      on
    ),
    { base_url: 'http://headroom:8787', auth_token: 'k' }
  );
  t.is(
    routeThroughHeadroom(
      'openai',
      { base_url: 'https://api.openai.com/', auth_token: 'k' },
      on
    ).base_url,
    'http://headroom:8787'
  );
});

test('custom base URLs, other providers and the off switch are left alone', t => {
  const gateway = { base_url: 'https://gateway.example.com', auth_token: 'k' };
  t.is(routeThroughHeadroom('openai', gateway, on), gateway);
  const official = { base_url: 'https://api.anthropic.com', auth_token: 'k' };
  t.is(routeThroughHeadroom('gemini', official, on), official);
  t.is(routeThroughHeadroom('anthropic', official, off), official);
  t.is(routeThroughHeadroom('anthropic', official, undefined), official);
  t.is(
    routeThroughHeadroom('anthropic', official, { ...on, proxyUrl: ' ' }),
    official
  );
});

test('the steering line ends the first system message, once', t => {
  const messages: PromptMessage[] = [
    { role: 'system', content: 'You are helpful.\n' },
    { role: 'user', content: 'hi' },
  ];
  const steered = steerTerse(messages, on);
  t.is(steered[0].content, `You are helpful.\n\n${TERSE_STEERING}`);
  t.is(steered[1], messages[1]);
  t.is(messages[0].content, 'You are helpful.\n');
  t.is(steerTerse(steered, on), steered);
});

test('no steering when off or with no system message', t => {
  const messages: PromptMessage[] = [{ role: 'user', content: 'hi' }];
  t.is(steerTerse(messages, on), messages);
  const withSystem: PromptMessage[] = [{ role: 'system', content: 's' }];
  t.is(steerTerse(withSystem, off), withSystem);
});

test('a run profile is told to compress and gets the steering line last', t => {
  const profile: {
    systemPrompt: string;
    allowedTools: string[];
    headroom?: AgentHeadroom;
  } = { systemPrompt: 'Rules.', allowedTools: ['Read'] };
  const next = withHeadroom(profile, on);
  t.deepEqual(next.headroom, { compressContext: true });
  t.true(next.systemPrompt.endsWith(TERSE_STEERING));
  t.deepEqual(next.allowedTools, ['Read']);
  t.is(withHeadroom(profile, off), profile);
  t.is(withHeadroom(profile, undefined), profile);
  t.is(withHeadroom(next, on).systemPrompt, next.systemPrompt);
});
