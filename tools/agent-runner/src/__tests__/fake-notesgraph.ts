/**
 * NotesGraph's agent-jobs API, just enough of it, on a real local port: jobs
 * to claim, reports, questions a test answers, run titles.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Job } from '../api';

interface StoredQuestion {
  id: string;
  kind: string;
  text: string;
  detail?: string | null;
  options?: string[];
  answer: string | null;
  allowed: boolean | null;
  answeredAt: number | null;
}

export class FakeNotesGraph {
  queue: Job[] = [];
  reports: Array<{ jobId: string; fields: Record<string, any> }> = [];
  questions: StoredQuestion[] = [];
  titles: string[] = [];
  devices: Record<string, any>[] = [];
  /** What a report hears back as the job's status (a stopped run says cancelled). */
  status = 'running';
  url = '';
  private server?: Server;

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        const reply = (value: unknown, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        if (req.headers.authorization !== 'Bearer pat') return reply({ message: 'no' }, 401);
        const path = req.url ?? '';
        let m: RegExpMatchArray | null;
        if (req.method === 'POST' && path.endsWith('/devices')) {
          this.devices.push(data);
          return reply({ device: data });
        }
        if (path.endsWith('/jobs/claim')) {
          const job = this.queue.shift() ?? null;
          return reply({ job: job ? { ...job, status: 'running' } : null });
        }
        if ((m = path.match(/\/jobs\/([^/]+)\/report$/))) {
          this.reports.push({ jobId: m[1], fields: data });
          return reply({ job: { id: m[1], status: data.status ?? this.status === 'cancelled' ? 'cancelled' : this.status } });
        }
        if ((m = path.match(/\/jobs\/([^/]+)\/title$/))) {
          this.titles.push(data.title);
          return reply({ job: { id: m[1], title: data.title } });
        }
        if (req.method === 'POST' && path.endsWith('/questions')) {
          const question: StoredQuestion = {
            id: `q${this.questions.length + 1}`,
            ...data,
            answer: null,
            allowed: null,
            answeredAt: null,
          };
          this.questions.push(question);
          return reply({ question });
        }
        if ((m = path.match(/\/questions\/([^/]+)$/))) {
          const question = this.questions.find(q => q.id === m![1]);
          return reply({ question, jobStatus: this.status });
        }
        return reply({ message: `no route ${path}` }, 404);
      });
    });
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  answer(index: number, reply: { answer?: string; allowed?: boolean }) {
    Object.assign(this.questions[index], reply, { answeredAt: 1 });
  }

  /** The transcript the runner sent, in order. */
  get log() {
    return this.reports.map(r => r.fields.logAppend ?? '').join('');
  }

  async stop() {
    await new Promise(resolve => this.server?.close(resolve));
  }
}

/** Wait until `check` holds, or fail after a few seconds. */
export async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 10));
  }
}
