import test from 'ava';

import {
  failedHealthStatus,
  healthStatus,
  parseHealthOutput,
} from '../health';

const LINUX = [
  'host=box-1',
  'os=Linux 6.8.0-1012-aws',
  'cpus=4',
  'load=0.52',
  'disk=41',
  'mem=63',
  'uptime=12 days,  3:04',
].join('\n');

test('reads the key=value lines and nothing else', t => {
  t.deepEqual(parseHealthOutput('host=a\nnoise here\nload=\n disk=7 \n'), {
    host: 'a',
    disk: '7',
  });
});

test('a healthy machine is online with a check a reading', t => {
  const status = healthStatus(LINUX);
  t.is(status.state, 'online');
  t.is(status.statusDetail, null);
  t.deepEqual(
    status.checks.map(check => [check.name, check.status]),
    [
      ['Disk', 'ok'],
      ['Memory', 'ok'],
      ['Load', 'ok'],
      ['Uptime', 'ok'],
      ['System', 'ok'],
    ]
  );
  t.is(status.checks[0].value, 41);
});

test('a full disk or busy CPUs degrade it, and say why', t => {
  const status = healthStatus(LINUX.replace('disk=41', 'disk=96').replace('load=0.52', 'load=7'));
  t.is(status.state, 'degraded');
  t.is(status.checks.find(check => check.name === 'Disk')?.status, 'fail');
  // 7 over 4 CPUs is 1.75 a CPU: a warning, not a failure.
  t.is(status.checks.find(check => check.name === 'Load')?.status, 'warn');
  t.is(status.statusDetail, 'Disk: 96% of / used; Load: 7 over 4 CPUs');
});

test('output with nothing readable leaves the state unknown', t => {
  const status = healthStatus('command not found');
  t.is(status.state, 'unknown');
  t.deepEqual(status.checks, []);
});

test('a check that failed to run degrades the machine with its error', t => {
  const status = failedHealthStatus("commands aren't allowed: set agent.allow_commands");
  t.is(status.state, 'degraded');
  t.regex(status.statusDetail, /allow_commands/);
  t.is(status.checks[0].status, 'fail');
});
