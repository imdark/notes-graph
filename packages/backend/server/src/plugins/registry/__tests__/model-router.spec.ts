import test from 'ava';

import { overridesIn, type RouteInput, routeModel } from '../model-router';

const code = (context: string, over: Partial<RouteInput> = {}) =>
  routeModel({
    agent: 'workflow',
    workdir: 'repo',
    context,
    instructions: 'work on the checkboxes until all are done',
    ...over,
  });

const notes = (context: string, over: Partial<RouteInput> = {}) =>
  routeModel({
    agent: 'claude-code',
    workdir: 'job',
    context,
    instructions: '',
    ...over,
  });

test('a routine code task runs on Opus at high effort', t => {
  const route = code('Add a share button to the run page');
  t.is(route.model, 'opus');
  t.is(route.effort, 'high');
  t.is(route.tier, 'code');
  t.is(route.fallbackModel, 'sonnet');
});

test('a hard code task gets more effort, and says why', t => {
  const route = code(
    'Research and implement a model router that will analyze the task'
  );
  t.is(route.model, 'opus');
  t.is(route.effort, 'xhigh');
  t.is(route.tier, 'hard');
  t.regex(route.reasons.join(' '), /research/);
});

test('a long checklist counts as hard', t => {
  const list = Array.from({ length: 6 }, (_, i) => `- [ ] step ${i}`).join(
    '\n'
  );
  const route = code(`Polish the settings page\n${list}`);
  t.is(route.effort, 'xhigh');
  t.regex(route.reasons.join(' '), /6 items/);
});

test('a one-line code fix runs on Sonnet', t => {
  const route = code('Fix the typo in the README');
  t.is(route.model, 'sonnet');
  t.is(route.effort, 'medium');
});

test('a short notes chore runs on Haiku', t => {
  const route = notes('Tag my meeting notes from this week with #work');
  t.is(route.model, 'haiku');
  t.is(route.tier, 'light');
  t.is(route.fallbackModel, undefined);
});

test('an open notes task runs on Sonnet', t => {
  const route = notes('Find a show to watch with Cosmo this weekend');
  t.is(route.model, 'sonnet');
  t.is(route.tier, 'standard');
});

test('a notes task that needs thought runs on Opus', t => {
  const route = notes('Design a weekly review process for my projects');
  t.is(route.model, 'opus');
  t.is(route.effort, 'high');
});

test('research runs on Opus at high effort', t => {
  const route = routeModel({
    agent: 'research',
    workdir: 'job',
    context: 'CPU embedding models',
    instructions: '',
  });
  t.is(route.model, 'opus');
  t.is(route.effort, 'high');
});

test('words are matched where they start, not inside others', t => {
  // "stage" holds "tag", "redesigned" isn't "design" at a word start.
  t.is(notes('What happens at the stage show?').tier, 'standard');
});

test('a small budget keeps a code run off Opus', t => {
  const route = code('Add a share button to the run page', {
    maxCostUsd: 0.5,
  });
  t.is(route.model, 'sonnet');
  t.regex(route.reasons.join(' '), /\$0\.5 budget/);
});

test('#model and #effort in the note win over the guess', t => {
  const route = code('Fix the typo in the README #model:fable #effort:max');
  t.is(route.model, 'fable');
  t.is(route.effort, 'max');
  t.is(route.fallbackModel, 'opus');
  t.regex(route.reasons.join(' '), /#model:fable/);
});

test('overrides take full ids and ignore names that are not models', t => {
  t.deepEqual(overridesIn('#model:claude-sonnet-5-5'), { model: 'sonnet' });
  t.deepEqual(overridesIn('#model:gpt-5 #effort:extreme'), {});
  t.deepEqual(overridesIn('mail#model:opus'), {});
});
