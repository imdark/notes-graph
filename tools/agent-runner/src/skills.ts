/**
 * The profile's skills as one Claude plugin: each SKILL.md fetched from its
 * own repo when the run starts (see agent-profiles.ts, `skills`). A skill
 * that can't be fetched is said in the transcript and left out; the run
 * goes on without it rather than failing.
 *
 * A skill whose url is a path ("/api/…") is a skill note, served by the
 * NotesGraph server this runner talks to: it is fetched from there with the
 * runner's token. Only such a path gets the token, never another host.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_SKILL_BYTES = 512 * 1024;

export async function skillsPlugin(
  skills: Array<{ name: string; url: string }>,
  jobDir: string,
  fetchImpl: typeof fetch,
  say: (line: string) => void,
  server?: { url: string; token: string }
): Promise<string | null> {
  if (!skills.length) return null;
  const root = join(jobDir, '.skills-plugin');
  let loaded = 0;
  for (const skill of skills) {
    const name = skill.name.replace(/[^A-Za-z0-9._-]/g, '-');
    try {
      const response = await fetchImpl(...skillRequest(skill.url, server));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_SKILL_BYTES) throw new Error('too large');
      await mkdir(join(root, 'skills', name), { recursive: true });
      await writeFile(join(root, 'skills', name, 'SKILL.md'), text);
      loaded += 1;
      say(`⚙ skill · ${name} ✓`);
    } catch (err) {
      say(`⚙ skill · ${name} ✗ couldn't fetch it (${err}); going on without it`);
    }
  }
  if (!loaded) return null;
  await mkdir(join(root, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'notesgraph-skills', version: '1.0.0', description: 'Skills from the agent profile' })
  );
  return root;
}

function skillRequest(
  url: string,
  server: { url: string; token: string } | undefined
): [string, RequestInit] {
  const signal = AbortSignal.timeout(20_000);
  if (!url.startsWith('/') || url.startsWith('//')) return [url, { signal }];
  if (!server) throw new Error('a skill note needs the NotesGraph server');
  return [
    `${server.url.replace(/\/$/, '')}${url}`,
    { signal, headers: { Authorization: `Bearer ${server.token}` } },
  ];
}
