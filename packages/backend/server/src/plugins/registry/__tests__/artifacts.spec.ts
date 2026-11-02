import test from 'ava';

import {
  MAX_ARTIFACT_BYTES,
  mimeFromName,
  RegistryJobService,
  safeArtifactName,
  toArtifactDto,
} from '../jobs';

/**
 * Files a run sends back (previews, renders) and the questions that show
 * them, against a stub Models and blob storage. What is checked: the key is
 * one path segment the blob route can serve, only the job's own files can be
 * attached to its question, and the caps say why they refuse.
 */

const workspaceId = 'ws-1';

const runningJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-12345678-abcd',
  workspaceId,
  status: 'running',
  access: null,
  allowAllTools: false,
  createdBy: 'user-1',
  ...overrides,
});

function artifactService(job: any, options: { count?: number } = {}) {
  const stored: { key: string; bytes: Buffer }[] = [];
  const rows: any[] = [];
  const asked: any[] = [];
  const models: any = {
    registryJob: {
      get: async () => job,
      countArtifacts: async () => options.count ?? rows.length,
      addArtifact: async (input: any) => {
        const row = {
          id: `a${rows.length + 1}`,
          createdAt: new Date(0),
          ...input,
        };
        rows.push(row);
        return row;
      },
      listArtifacts: async () => rows,
      ownArtifactKeys: async (_jobId: string, keys: string[]) =>
        keys.filter(key => rows.some(row => row.key === key)),
      ask: async (jobId: string, input: any) => (
        asked.push(input),
        {
          id: 'q1',
          jobId,
          ...input,
          answer: null,
          allowed: null,
          createdAt: new Date(0),
          answeredAt: null,
        }
      ),
    },
  };
  const blobs: any = {
    put: async (_ws: string, key: string, bytes: Buffer) => {
      stored.push({ key, bytes });
    },
    get: async () => ({ metadata: { contentType: 'video/mp4' } }),
  };
  const service = new RegistryJobService(
    models,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    blobs
  );
  return { service, stored, rows, asked };
}

test('a file name becomes one safe blob segment', t => {
  t.is(safeArtifactName('edit/preview.mp4'), 'preview.mp4');
  t.is(safeArtifactName('C:\\clips\\My Take (2).MOV'), 'My-Take-2-.MOV');
  t.is(safeArtifactName('../../etc/passwd'), 'passwd');
  t.is(safeArtifactName(''), 'artifact');
  t.is(safeArtifactName('x'.repeat(200)).length, 80);
});

test('a mime is guessed from the extension when storage has none', t => {
  t.is(mimeFromName('preview.MP4'), 'video/mp4');
  t.is(mimeFromName('strip.png'), 'image/png');
  t.is(mimeFromName('master.srt'), 'text/plain');
  t.is(mimeFromName('noext'), undefined);
});

test('a running job stores a file under its own key and lists it', async t => {
  const { service, stored, rows } = artifactService(runningJob());
  const artifact = await service.addArtifact(
    workspaceId,
    'job-12345678-abcd',
    'preview.mp4',
    Buffer.from('mp4 bytes')
  );
  t.is(stored.length, 1);
  t.is(stored[0].key, artifact.key);
  // One segment, named after the job, ending in the file name.
  t.false(artifact.key.includes('/'));
  t.true(artifact.key.startsWith('agent-job-1234-'));
  t.true(artifact.key.endsWith('-preview.mp4'));
  t.is(artifact.mime, 'video/mp4');
  t.is(artifact.size, 9);
  t.is(artifact.url, `/api/workspaces/${workspaceId}/blobs/${artifact.key}`);
  t.is(rows.length, 1);
  const listed = await service.listArtifacts(workspaceId, 'job-12345678-abcd');
  t.deepEqual(
    listed.map(a => a.key),
    [artifact.key]
  );
});

test('a finished job, an empty file and an oversized file are refused', async t => {
  const done = artifactService(runningJob({ status: 'done' }));
  await t.throwsAsync(
    done.service.addArtifact(
      workspaceId,
      'job-12345678-abcd',
      'a.mp4',
      Buffer.from('x')
    ),
    { message: /is done, not running/ }
  );
  const { service } = artifactService(runningJob());
  await t.throwsAsync(
    service.addArtifact(
      workspaceId,
      'job-12345678-abcd',
      'a.mp4',
      Buffer.alloc(0)
    ),
    { message: /empty/ }
  );
  await t.throwsAsync(
    service.addArtifact(
      workspaceId,
      'job-12345678-abcd',
      'a.mp4',
      Buffer.alloc(MAX_ARTIFACT_BYTES + 1)
    ),
    { message: /capped at 100 MB/ }
  );
});

test('a run that sent too many files is told so', async t => {
  const { service } = artifactService(runningJob(), { count: 40 });
  await t.throwsAsync(
    service.addArtifact(
      workspaceId,
      'job-12345678-abcd',
      'a.mp4',
      Buffer.from('x')
    ),
    { message: /at most 40 per run/ }
  );
});

test("a question shows only the job's own files", async t => {
  const { service, asked } = artifactService(runningJob());
  const mine = await service.addArtifact(
    workspaceId,
    'job-12345678-abcd',
    'preview.mp4',
    Buffer.from('x')
  );
  const question = await service.ask(workspaceId, 'job-12345678-abcd', {
    text: 'Approve this cut?',
    options: ['Approve', 'Revise'],
    attachments: [
      mine.key,
      'agent-other-job-final.mp4',
      'has/slash.png',
      mine.key,
    ],
  });
  t.deepEqual(asked[0].attachments, [mine.key]);
  t.deepEqual(question.attachments, [mine.key]);
});

test('a permission carries no attachments', async t => {
  const { service, asked } = artifactService(runningJob());
  await service.ask(workspaceId, 'job-12345678-abcd', {
    kind: 'permission',
    text: 'Allow Bash?',
    attachments: ['agent-job-1234-aa-preview.mp4'],
  });
  t.deepEqual(asked[0].attachments, []);
});

test('an artifact row reads back as the wire shape', t => {
  const dto = toArtifactDto({
    id: 'a1',
    jobId: 'job-1',
    workspaceId,
    key: 'agent-job-1-abc-final.mp4',
    name: 'final.mp4',
    mime: 'video/mp4',
    size: 1234,
    createdAt: new Date(5000),
  } as any);
  t.is(dto.createdAt, 5);
  t.is(
    dto.url,
    `/api/workspaces/${workspaceId}/blobs/agent-job-1-abc-final.mp4`
  );
});

test('a server without blob storage says so instead of crashing', async t => {
  const models: any = {
    registryJob: {
      get: async () => runningJob(),
      countArtifacts: async () => 0,
    },
  };
  const service = new RegistryJobService(models);
  await t.throwsAsync(
    service.addArtifact(
      workspaceId,
      'job-12345678-abcd',
      'a.mp4',
      Buffer.from('x')
    ),
    { message: /keeps no files/ }
  );
});
