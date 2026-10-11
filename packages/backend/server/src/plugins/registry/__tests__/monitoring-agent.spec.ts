import test from 'ava';

import { healthStatus } from '../health';
import {
  assess,
  type Baseline,
  COOLDOWN_MS,
  isRepeat,
  judge,
  learn,
  readChecks,
  triageInstructions,
  WARMUP,
} from '../monitoring-agent';

const linux = (disk: number, mem: number, load: number) =>
  healthStatus(
    [`cpus=4`, `load=${load}`, `disk=${disk}`, `mem=${mem}`, 'uptime=3 days', 'os=Linux 6.8'].join('\n')
  ).checks;

/** Run `n` health checks through assess, carrying the baselines like the service does. */
function train(baselines: Map<string, Baseline>, n: number, reading: () => unknown[]) {
  for (let i = 0; i < n; i++) {
    const { updates } = assess(reading(), baselines, 3);
    for (const [key, value] of updates) baselines.set(key, value);
  }
  return baselines;
}

test('reads values and states from health checks and loose wf checks', t => {
  const { readings, states } = readChecks([
    ...linux(41, 60, 0.5),
    { check: 'Backup age', ok: false, value: 30 },
    { nothing: true },
  ]);
  t.deepEqual(
    readings.map(r => `${r.metric}=${r.value}`).sort(),
    ['backup-age=30', 'disk=41', 'load=0.5', 'memory=60']
  );
  t.deepEqual(states.find(s => s.name === 'Backup age'), { name: 'Backup age', status: 'fail' });
});

test('the baseline follows a steady reading and stays tight', t => {
  let b: Baseline | null = null;
  for (let i = 0; i < 20; i++) b = learn(b, 40 + (i % 2));
  t.true(Math.abs(b!.mean - 40.5) < 0.6);
  t.true(Math.sqrt(b!.variance) < 1);
  t.is(b!.samples, 20);
});

test('nothing is judged while a baseline is still warming up', t => {
  let b: Baseline | null = null;
  for (let i = 0; i < WARMUP - 1; i++) b = learn(b, 40);
  t.is(judge({ metric: 'disk', label: 'Disk', value: 99 }, b, 3), null);
});

test('a jump far above normal is an anomaly; a small wobble is not', t => {
  let b: Baseline | null = null;
  for (let i = 0; i < 30; i++) b = learn(b, 40);
  // A flat baseline still allows the disk's 2-point floor of spread.
  t.is(judge({ metric: 'disk', label: 'Disk', value: 44 }, b, 3), null);
  const warn = judge({ metric: 'disk', label: 'Disk', value: 48 }, b, 3);
  t.is(warn?.kind, 'anomaly');
  t.is(warn?.severity, 'warn');
  t.regex(warn!.summary, /Disk is 48%; normal here is about 40%/);
  t.is(judge({ metric: 'disk', label: 'Disk', value: 70 }, b, 3)?.severity, 'critical');
});

test('a drop in disk or memory is not news; an unknown metric alarms both ways', t => {
  let b: Baseline | null = null;
  for (let i = 0; i < 30; i++) b = learn(b, 60);
  t.is(judge({ metric: 'memory', label: 'Memory', value: 5 }, b, 3), null);
  t.is(judge({ metric: 'queue-depth', label: 'Queue depth', value: 5 }, b, 3)?.kind, 'anomaly');
});

test('a warn state the machine has never been in is new, once it is known', t => {
  const baselines = train(new Map(), WARMUP, () => linux(41, 60, 0.5));
  const { findings, updates } = assess(linux(96, 60, 0.5), baselines, 3);
  const fresh = findings.find(f => f.kind === 'new');
  t.is(fresh?.metric, 'seen:Disk:fail');
  t.is(fresh?.severity, 'critical');
  // And next time it is known.
  for (const [key, value] of updates) baselines.set(key, value);
  t.falsy(assess(linux(96, 60, 0.5), baselines, 3).findings.find(f => f.kind === 'new'));
});

test('during the first checks of a machine nothing is new', t => {
  const { findings } = assess(linux(96, 60, 0.5), new Map(), 3);
  t.deepEqual(findings, []);
});

test('an anomaly is learned slowly, so one spike does not become normal', t => {
  const baselines = train(new Map(), 30, () => linux(40, 50, 0.5));
  const { updates, findings } = assess(linux(60, 50, 0.5), baselines, 3);
  t.truthy(findings.find(f => f.metric === 'disk'));
  t.true(updates.get('disk')!.mean < 43);
});

test('a repeat inside the cooldown is folded unless it got worse or was resolved', t => {
  const now = Date.now();
  const recent = { severity: 'warn', verdict: null, createdAt: new Date(now - 60_000) };
  t.true(isRepeat({ severity: 'warn' }, recent, now));
  t.false(isRepeat({ severity: 'critical' }, recent, now));
  t.false(isRepeat({ severity: 'warn' }, { ...recent, verdict: 'resolved' }, now));
  t.false(isRepeat({ severity: 'warn' }, { ...recent, createdAt: new Date(now - COOLDOWN_MS - 1) }, now));
  t.false(isRepeat({ severity: 'warn' }, null, now));
});

test('a triage run is told to stay read-only and answer in a fixed shape', t => {
  const text = triageInstructions(
    { key: 'box-1', name: 'Box 1' },
    { summary: 'Disk is 96%', metric: 'disk', kind: 'anomaly', severity: 'critical' }
  );
  t.regex(text, /read-only commands only/);
  t.regex(text, /Do not change, delete, restart or install/);
  t.regex(text, /Likely cause:/);
});
