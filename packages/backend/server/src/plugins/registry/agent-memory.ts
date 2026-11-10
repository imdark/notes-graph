import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { RegistryJob } from '@prisma/client';

import { Config, OnEvent } from '../../base';
import { DocReader, DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import {
  buildStructuredResponseFromSchemaJson,
  type RequiredStructuredOutputContract,
} from '../copilot/runtime/contracts';
import { PromptRuntime } from '../copilot/runtime/prompt-runtime';
import {
  applyMemoryOps,
  extractionContent,
  groupByDomain,
  groupBySubject,
  type LessonOp,
  LESSONS_ROOT_TITLE,
  lessonsSection,
  linkedDocIds,
  MEMORY_ROOT_TITLE,
  type MemoryOps,
  newLessonNote,
  parseExtraction,
  parseFacts,
  parseLessons,
  recallFacts,
  recallLessons,
  recallSection,
} from './agent-memory-facts';
import { type AgentProfile, profileFor } from './agent-profiles';

const EXTRACT_PROMPT = 'Extract user memory';

const OP_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { subject: { type: 'string' }, fact: { type: 'string' } },
    required: ['subject', 'fact'],
    additionalProperties: false,
  },
};

const LESSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      domain: { type: 'string' },
      lesson: { type: 'string' },
      appliesTo: { type: 'string' },
    },
    required: ['domain', 'lesson', 'appliesTo'],
    additionalProperties: false,
  },
};

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: { create: OP_SCHEMA, delete: OP_SCHEMA, lessons: LESSON_SCHEMA },
  required: ['create', 'delete', 'lessons'],
  additionalProperties: false,
};

/** Subject notes read per run; a memory larger than this is read in part. */
const MAX_NOTES = 60;

const ROOT_BODY =
  'What agents have learned about you, one note per subject, each linked ' +
  'below. Edit or delete anything here: agents read these notes before ' +
  'they start, and add to them after a run.';

const LESSONS_ROOT_BODY =
  'How you want kinds of tasks done, one note per kind (e.g. "Trip ' +
  'planning"), each linked below. An agent whose task is of that kind is ' +
  'given every lesson in its note. Add an "Applies to:" line to a note to ' +
  'name the words that mark such tasks, e.g. "Applies to: trip, travel, ' +
  'vacation". Edit or delete anything here.';

interface Memory {
  rootId: string | null;
  notes: { docId: string; subject: string; markdown: string }[];
}

/**
 * Automatic memory, kept as notes the person can read and edit: when an agent
 * run ends, a one-shot extraction proposes facts about the user to add to (or
 * drop from) the "Agent memory" notes, one note per subject; when a run is
 * claimed, the facts that bear on it and the most recent ones go into its
 * system prompt.
 *
 * The same extraction proposes lessons: how the user wants a kind of task
 * done, appended to that kind's note under "Agent lessons". A run whose task
 * is of a kind with a note gets all of that note's lessons, so a checklist
 * learned once ("when planning a trip, pack games for the kids") is acted on
 * every time rather than found by chance.
 *
 * Only runs a person started on a Claude agent are read: a health check or
 * other device job has nothing to say about anyone. The extraction is not a
 * job itself, so remembering a run can't set off another. Copilot may not be
 * configured, and nothing here may fail the run it rides on: a memory that
 * can't be read or written is logged and skipped.
 */
@Injectable()
export class AgentMemoryService {
  private readonly logger = new Logger(AgentMemoryService.name);
  /**
   * "Agent memory" and "Agent lessons" notes created here, by workspace and
   * title, until their title has reached workspace_pages (on the next
   * snapshot) and they can be found.
   */
  private readonly createdRoots = new Map<string, string>();
  /**
   * One extraction at a time per workspace, so two runs ending together
   * don't each create "Agent memory" or the same subject note.
   */
  private readonly queues = new Map<string, Promise<void>>();
  private contract?: RequiredStructuredOutputContract;

  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly reader: DocReader,
    private readonly writer: DocWriter,
    private readonly ac: PermissionAccess,
    private readonly ref: ModuleRef
  ) {}

  private get enabled() {
    return this.config.registry.agentMemory !== false;
  }

  @OnEvent('registry.job.finished')
  async onJobFinished(event: Events['registry.job.finished']) {
    // An automation runs code, not an agent: there is nobody to learn about.
    if (!this.enabled || event.kind === 'automation') return;
    const { workspaceId, jobId } = event;
    const next = (this.queues.get(workspaceId) ?? Promise.resolve())
      .then(() => this.remember(workspaceId, jobId))
      .catch(err => {
        this.logger.warn(
          `job ${jobId}: couldn't update agent memory: ${(err as Error).message}`
        );
      });
    this.queues.set(workspaceId, next);
    await next;
    if (this.queues.get(workspaceId) === next) this.queues.delete(workspaceId);
  }

  /** `profile` with what is known about the job's starter added, if anything. */
  async withRecall(
    job: RegistryJob,
    profile: AgentProfile | null
  ): Promise<AgentProfile | null> {
    if (!profile || !job.createdBy || !this.enabled) return profile;
    try {
      const query = `${job.title ?? ''}\n${job.instructions}`;
      const memory = await this.load(
        job.workspaceId,
        job.createdBy,
        MEMORY_ROOT_TITLE
      );
      const facts = (memory?.notes ?? []).flatMap(note =>
        parseFacts(note.subject, note.markdown)
      );
      const lessons = await this.load(
        job.workspaceId,
        job.createdBy,
        LESSONS_ROOT_TITLE
      );
      const section =
        recallSection(recallFacts(facts, query)) +
        lessonsSection(
          recallLessons(
            (lessons?.notes ?? []).map(note =>
              parseLessons(note.subject, note.markdown)
            ),
            query
          )
        );
      if (!section) return profile;
      return {
        ...profile,
        systemPrompt: `${profile.systemPrompt}\n${section}`,
      };
    } catch (err) {
      this.logger.warn(
        `job ${job.id}: couldn't recall agent memory: ${(err as Error).message}`
      );
      return profile;
    }
  }

  private async remember(workspaceId: string, jobId: string) {
    const job = await this.models.registryJob.get(workspaceId, jobId);
    const userId = job?.createdBy;
    if (!job || !userId || !profileFor(job.model)) return;
    const questions = (
      await this.models.registryJob.listQuestions(job.id)
    ).flatMap(q =>
      q.kind === 'question' && q.answer?.trim()
        ? [{ text: q.text, answer: q.answer }]
        : []
    );
    if (!job.log.trim() && !job.result?.trim() && !questions.length) return;

    const runtime = this.promptRuntime();
    if (!runtime) return;
    const memory = await this.load(workspaceId, userId, MEMORY_ROOT_TITLE);
    const lessons = await this.load(workspaceId, userId, LESSONS_ROOT_TITLE);
    // A memory note this person can't read is not one to write to either.
    if (!memory && !lessons) return;

    const today = new Date().toISOString().slice(0, 10);
    const content = extractionContent({
      today,
      instructions: job.instructions,
      title: job.title,
      questions,
      result: job.result,
      log: job.log,
      facts: (memory?.notes ?? []).flatMap(note =>
        parseFacts(note.subject, note.markdown)
      ),
      lessons: (lessons?.notes ?? []).map(note =>
        parseLessons(note.subject, note.markdown)
      ),
    });
    const output = await runtime.runStructured(
      EXTRACT_PROMPT,
      { content },
      {
        responseContract: this.responseContract(),
        providerOptions: { user: userId, workspace: workspaceId },
      }
    );
    const ops = parseExtraction(output.value);
    if (memory && (ops.create.length || ops.delete.length)) {
      const { created, deleted } = await this.apply(
        workspaceId,
        userId,
        memory,
        ops,
        today
      );
      if (created || deleted) {
        this.logger.log(
          `job ${jobId}: agent memory +${created} -${deleted} fact(s)`
        );
      }
    }
    if (lessons && ops.lessons.length) {
      const learned = await this.applyLessons(
        workspaceId,
        userId,
        lessons,
        ops.lessons,
        today
      );
      if (learned) {
        this.logger.log(`job ${jobId}: agent lessons +${learned}`);
      }
    }
  }

  /** New lessons appended to their domain's note, or a new note for one. */
  private async applyLessons(
    workspaceId: string,
    userId: string,
    memory: Memory,
    ops: LessonOp[],
    today: string
  ) {
    let created = 0;
    for (const [key, group] of groupByDomain(ops)) {
      const note = memory.notes.find(
        n => n.subject.trim().toLowerCase() === key
      );
      const add = { create: group.lessons, delete: [] };
      if (note) {
        const can = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(note.docId)
          .can('Doc.Update');
        if (!can) continue;
        const next = applyMemoryOps(note.markdown, note.subject, add, today);
        if (!next.created) continue;
        await this.writer.updateDoc(
          workspaceId,
          note.docId,
          next.markdown,
          userId
        );
        note.markdown = next.markdown;
        created += next.created;
        continue;
      }

      const next = applyMemoryOps(
        newLessonNote(group.appliesTo),
        group.domain,
        add,
        today
      );
      if (!next.created) continue;
      const rootId =
        memory.rootId ??
        (await this.createRoot(
          workspaceId,
          userId,
          LESSONS_ROOT_TITLE,
          LESSONS_ROOT_BODY
        ));
      if (!rootId) return created;
      memory.rootId = rootId;
      const { docId } = await this.writer.createDoc(
        workspaceId,
        group.domain,
        next.markdown,
        userId
      );
      await this.writer.linkDoc(workspaceId, rootId, docId, userId);
      memory.notes.push({
        docId,
        subject: group.domain,
        markdown: next.markdown,
      });
      created += next.created;
    }
    return created;
  }

  private async apply(
    workspaceId: string,
    userId: string,
    memory: Memory,
    ops: MemoryOps,
    today: string
  ) {
    let created = 0;
    let deleted = 0;
    for (const [key, group] of groupBySubject(ops)) {
      const note = memory.notes.find(
        n => n.subject.trim().toLowerCase() === key
      );
      if (note) {
        const can = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(note.docId)
          .can('Doc.Update');
        if (!can) continue;
        const next = applyMemoryOps(note.markdown, note.subject, group, today);
        if (!next.created && !next.deleted) continue;
        await this.writer.updateDoc(
          workspaceId,
          note.docId,
          next.markdown,
          userId
        );
        note.markdown = next.markdown;
        created += next.created;
        deleted += next.deleted;
        continue;
      }

      // Nothing to delete from a subject with no note.
      const next = applyMemoryOps(
        '',
        group.subject,
        { create: group.create, delete: [] },
        today
      );
      if (!next.created) continue;
      const rootId =
        memory.rootId ??
        (await this.createRoot(
          workspaceId,
          userId,
          MEMORY_ROOT_TITLE,
          ROOT_BODY
        ));
      if (!rootId) return { created, deleted };
      memory.rootId = rootId;
      const { docId } = await this.writer.createDoc(
        workspaceId,
        group.subject,
        next.markdown,
        userId
      );
      await this.writer.linkDoc(workspaceId, rootId, docId, userId);
      memory.notes.push({
        docId,
        subject: group.subject,
        markdown: next.markdown,
      });
      created += next.created;
    }
    return { created, deleted };
  }

  private async createRoot(
    workspaceId: string,
    userId: string,
    title: string,
    body: string
  ) {
    const can = await this.ac
      .user(userId)
      .workspace(workspaceId)
      .can('Workspace.CreateDoc');
    if (!can) return null;
    const { docId } = await this.writer.createDoc(
      workspaceId,
      title,
      body,
      userId
    );
    this.createdRoots.set(`${workspaceId}\n${title}`, docId);
    return docId;
  }

  /**
   * The note titled `title` ("Agent memory" or "Agent lessons") and the
   * subject notes linked from it. Null when there is one but `userId` may not
   * read it; no root when there is none yet.
   */
  private async load(
    workspaceId: string,
    userId: string,
    title: string
  ): Promise<Memory | null> {
    const found = await this.models.doc.findIdsByExactTitle(workspaceId, title);
    const key = `${workspaceId}\n${title}`;
    const created = this.createdRoots.get(key);
    if (created && found.includes(created)) this.createdRoots.delete(key);
    const rootId = this.createdRoots.get(key) ?? found[0];
    if (!rootId) return { rootId: null, notes: [] };

    const access = this.ac.user(userId).workspace(workspaceId);
    if (!(await access.doc(rootId).can('Doc.Read'))) return null;
    const root = await this.reader.getDocMarkdown(workspaceId, rootId, false);
    if (!root) {
      // Unreadable rather than absent: skip, rather than start a second one.
      if (rootId === created) this.createdRoots.delete(key);
      return null;
    }

    const ids = linkedDocIds(root.markdown, rootId).slice(0, MAX_NOTES);
    const readable = ids.length
      ? await access.docs(
          ids.map(docId => ({ docId })),
          'Doc.Read'
        )
      : [];
    const notes: Memory['notes'] = [];
    for (const { docId } of readable) {
      const doc = await this.reader.getDocMarkdown(workspaceId, docId, false);
      const subject = doc?.title.trim();
      if (doc && subject)
        notes.push({ docId, subject, markdown: doc.markdown });
    }
    return { rootId, notes };
  }

  /** Copilot's prompt runner, or null on a server without copilot. */
  private promptRuntime(): PromptRuntime | null {
    try {
      return this.ref.get(PromptRuntime, { strict: false });
    } catch {
      return null;
    }
  }

  private responseContract(): RequiredStructuredOutputContract {
    if (!this.contract) {
      const { responseSchemaJson, schemaHash } =
        buildStructuredResponseFromSchemaJson(EXTRACTION_SCHEMA);
      if (!responseSchemaJson || !schemaHash) {
        throw new Error('Agent memory extraction contract is required');
      }
      this.contract = { responseSchemaJson, schemaHash };
    }
    return this.contract;
  }
}
