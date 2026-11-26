/**
 * Picks the Claude model and effort a run starts on, from what the job asks
 * and which agent asks it. Before this every run took Claude Code's default
 * model at its default effort: a one-line "tag these notes" paid what a
 * multi-day refactor does, and a hard design task got no more thought than a
 * typo fix.
 *
 * Rules, not a model call: the decision is made on every claim, has to be
 * explainable in the run's transcript, and must not fail a run. Effort moves
 * first and the model second, because the newest models at lower effort often
 * match a bigger model at higher effort, and a run keeps one model throughout
 * (prompt caches are per model). See "Model router research (2026-11-19)" in
 * NotesGraph for the reasoning and prices behind the tiers.
 *
 * The person can always overrule it from the note: `#model:sonnet` or
 * `#effort:high` in the task's text wins over anything guessed here.
 */

/** Claude Code's aliases, so a run follows the CLI to each model's latest. */
export const ROUTER_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type RouterModel = (typeof ROUTER_MODELS)[number];

export const ROUTER_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type RouterEffort = (typeof ROUTER_EFFORTS)[number];

export type RouteTier = 'light' | 'standard' | 'code' | 'hard';

export interface ModelRoute {
  model: RouterModel;
  effort: RouterEffort;
  /** Tried, in order, when the model is overloaded or unavailable. */
  fallbackModel?: RouterModel;
  tier: RouteTier;
  /** Why, in a few words each, for the run's transcript. */
  reasons: string[];
}

export interface RouteInput {
  /** The agent kind: 'claude-code', 'workflow', 'research', 'video-editor'. */
  agent: string | null | undefined;
  /** Where the agent works: a checkout of the repo, or an empty directory. */
  workdir: 'repo' | 'job';
  /** The note item the run was started on. */
  context: string;
  /** The agent's standing instructions. */
  instructions: string;
  title?: string | null;
  /** The run's spending cap in USD, if it has one. */
  maxCostUsd?: number | null;
}

// Words that mark a task as more than a routine change. Matched on word
// starts, so "architect" covers "architecture".
const HARD_WORDS = [
  'research',
  'investigat',
  'architect',
  'design',
  'refactor',
  'migrat',
  'rewrite',
  'redesign',
  'debug',
  'diagnos',
  'root cause',
  'race condition',
  'deadlock',
  'performance',
  'perf ',
  'optimi',
  'security',
  'vulnerab',
  'concurren',
  'algorithm',
  'end-to-end',
  'from scratch',
  'across the',
  'whole app',
];

// Chores a short run does with a handful of tool calls.
const LIGHT_WORDS = [
  'tag',
  'rename',
  'retitle',
  'summari',
  'list ',
  'remind',
  'format',
  'translat',
  'spell',
  'typo',
  'reword',
  'move ',
  'link ',
  'archive',
  'clean up',
  'sort',
  'count',
  'look up',
  'check ',
];

// Code changes small enough that a mid-sized model at moderate effort does
// them as well as the biggest one.
const SMALL_CODE_WORDS = [
  'typo',
  'rename',
  'bump',
  'copy',
  'wording',
  'string',
  'label',
  'comment',
  'readme',
  'changelog',
  'version',
  'lint',
];

/** Where a word starts in text, not inside another word. */
const mentions = (text: string, word: string) => {
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1])) return true;
  }
  return false;
};

const hits = (text: string, words: string[]) =>
  words.filter(word => mentions(text, word)).map(word => word.trim());

const MODEL_TAG = /(?:^|\s)#model:([a-z0-9.-]+)/i;
const EFFORT_TAG = /(?:^|\s)#effort:([a-z]+)/i;

/** `#model:…` and `#effort:…` in the note item, when they name real ones. */
export function overridesIn(text: string): {
  model?: RouterModel;
  effort?: RouterEffort;
} {
  const model = MODEL_TAG.exec(text)?.[1]?.toLowerCase();
  const effort = EFFORT_TAG.exec(text)?.[1]?.toLowerCase();
  // `claude-opus-5-5` names the family as well as the alias does.
  const family = ROUTER_MODELS.find(
    name => model === name || model?.includes(`-${name}`)
  );
  return {
    ...(family ? { model: family } : {}),
    ...((ROUTER_EFFORTS as readonly string[]).includes(effort ?? '')
      ? { effort: effort as RouterEffort }
      : {}),
  };
}

/** Checkboxes and bullet items in the note item: a list is several tasks. */
const itemCount = (text: string) =>
  text.split('\n').filter(line => /^\s*(?:[-*+]|\d+\.|\[[ xX]\])\s/.test(line))
    .length;

const FALLBACK: Record<RouterModel, RouterModel | undefined> = {
  fable: 'opus',
  opus: 'sonnet',
  sonnet: 'haiku',
  haiku: undefined,
};

// A budget this small can't carry an Opus-sized code run to the end.
const SMALL_BUDGET_USD = 1;

export function routeModel(input: RouteInput): ModelRoute {
  const task = `${input.title ?? ''}\n${input.context}`.toLowerCase();
  const reasons: string[] = [];
  const code = input.workdir === 'repo';
  const items = itemCount(input.context);
  const length = input.context.trim().length;
  const hard = hits(task, HARD_WORDS);

  let tier: RouteTier;
  let model: RouterModel;
  let effort: RouterEffort;

  if (input.agent === 'research') {
    // Reading-heavy: breadth matters more than depth per step.
    tier = 'hard';
    model = 'opus';
    effort = 'high';
    reasons.push('research agent');
  } else if (code) {
    const small = hits(task, SMALL_CODE_WORDS);
    if (hard.length || items >= 5 || length > 1500) {
      tier = 'hard';
      model = 'opus';
      effort = 'xhigh';
      if (hard.length)
        reasons.push(`code task that says ${hard.slice(0, 3).join(', ')}`);
      if (items >= 5) reasons.push(`${items} items to work through`);
      if (length > 1500) reasons.push('long task description');
    } else if (small.length && length < 300 && items <= 1) {
      tier = 'standard';
      model = 'sonnet';
      effort = 'medium';
      reasons.push(`small code change (${small.slice(0, 2).join(', ')})`);
    } else {
      tier = 'code';
      model = 'opus';
      effort = 'high';
      reasons.push('code task');
    }
  } else {
    const light = hits(task, LIGHT_WORDS);
    if (hard.length || length > 1500) {
      tier = 'hard';
      model = 'opus';
      effort = 'high';
      reasons.push(
        hard.length
          ? `notes task that says ${hard.slice(0, 3).join(', ')}`
          : 'long task description'
      );
    } else if (light.length && length < 400 && items <= 3) {
      tier = 'light';
      model = 'haiku';
      effort = 'medium';
      reasons.push(`short notes chore (${light.slice(0, 2).join(', ')})`);
    } else {
      tier = 'standard';
      model = 'sonnet';
      effort = 'medium';
      reasons.push('notes task');
    }
  }

  const cap = input.maxCostUsd;
  if (
    typeof cap === 'number' &&
    cap > 0 &&
    cap < SMALL_BUDGET_USD &&
    model === 'opus'
  ) {
    model = 'sonnet';
    reasons.push(`$${cap} budget`);
  }

  const override = overridesIn(input.context);
  if (override.model && override.model !== model) {
    model = override.model;
    reasons.push(`#model:${override.model} in the note`);
  }
  if (override.effort && override.effort !== effort) {
    effort = override.effort;
    reasons.push(`#effort:${override.effort} in the note`);
  }

  const fallbackModel = FALLBACK[model];
  return {
    model,
    effort,
    ...(fallbackModel ? { fallbackModel } : {}),
    tier,
    reasons,
  };
}
