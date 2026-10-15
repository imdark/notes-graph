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
  groupBySubject,
  linkedDocIds,
  MEMORY_ROOT_TITLE,
  type MemoryOps,
  parseExtraction,
  parseFacts,
  recallFacts,
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

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: { create: OP_SCHEMA, delete: OP_SCHEMA },
  required: ['create', 'delete'],
  additionalProperties: false,
};

/** Subject notes read per run; a memory larger than this is read in part. */
const MAX_NOTES = 60;

const ROOT_BODY =
  'What agents have learned about you, one note per subject, each linked ' +
  'below. Edit or delete anything here: agents read these notes before ' +
  'they start, and add to them after a run.';

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
   * "Agent memory" notes created here, by workspace, until their title has
   * reached workspace_pages (on the next snapshot) and they can be found.
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
    if (!this.enabled) return;
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
      const memory = await this.load(job.workspaceId, job.createdBy);
      if (!memory?.notes.length) return profile;
      const facts = memory.notes.flatMap(note => parseFacts(note.subject, note.markdown));
      const section = recallSection(
        recallFacts(facts, `${job.title ?? ''}\n${job.instructions}`)
      );
      if (!section) return profile;
      return { ...profile, systemPrompt: `${profile.systemPrompt}\n${section}` };
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
    const questions = (await this.models.registryJob.listQuestions(job.id))
      .filter(q => q.kind === 'question' && q.answer?.trim())
      .map(q => ({ text: q.text, answer: q.answer! }));
    if (!job.log.trim() && !job.result?.trim() && !questions.length) return;

    const runtime = this.promptRuntime();
    if (!runtime) return;
    const memory = await this.load(workspaceId, userId);
    // A memory note this person can't read is not one to write to either.
    if (!memory) return;

    const today = new Date().toISOString().slice(0, 10);
    const content = extractionContent({
      today,
      instructions: job.instructions,
      title: job.title,
      questions,
      result: job.result,
      log: job.log,
      facts: memory.notes.flatMap(note => parseFacts(note.subject, note.markdown)),
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
    if (!ops.create.length && !ops.delete.length) return;
    const { created, deleted } = await this.apply(workspaceId, userId, memory, ops, today);
    if (created || deleted) {
      this.logger.log(
        `job ${jobId}: agent memory +${created} -${deleted} fact(s)`
      );
    }
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
      const note = memory.notes.find(n => n.subject.trim().toLowerCase() === key);
      if (note) {
        const can = await this.ac
          .user(userId)
          .workspace(workspaceId)
          .doc(note.docId)
          .can('Doc.Update');
        if (!can) continue;
        const next = applyMemoryOps(note.markdown, note.subject, group, today);
        if (!next.created && !next.deleted) continue;
        await this.writer.updateDoc(workspaceId, note.docId, next.markdown, userId);
        note.markdown = next.markdown;
        created += next.created;
        deleted += next.deleted;
        continue;
      }

      // Nothing to delete from a subject with no note.
      const next = applyMemoryOps('', group.subject, { create: group.create, delete: [] }, today);
      if (!next.created) continue;
      const rootId = memory.rootId ?? (await this.createRoot(workspaceId, userId));
      if (!rootId) return { created, deleted };
      memory.rootId = rootId;
      const { docId } = await this.writer.createDoc(
        workspaceId,
        group.subject,
        next.markdown,
        userId
      );
      await this.writer.linkDoc(workspaceId, rootId, docId, userId);
      memory.notes.push({ docId, subject: group.subject, markdown: next.markdown });
      created += next.created;
    }
    return { created, deleted };
  }

  private async createRoot(workspaceId: string, userId: string) {
    const can = await this.ac
      .user(userId)
      .workspace(workspaceId)
      .can('Workspace.CreateDoc');
    if (!can) return null;
    const { docId } = await this.writer.createDoc(
      workspaceId,
      MEMORY_ROOT_TITLE,
      ROOT_BODY,
      userId
    );
    this.createdRoots.set(workspaceId, docId);
    return docId;
  }

  /**
   * The "Agent memory" note and the subject notes linked from it. Null when
   * there is one but `userId` may not read it; no root when there is none yet.
   */
  private async load(workspaceId: string, userId: string): Promise<Memory | null> {
    const found = await this.models.doc.findIdsByTitle(workspaceId, MEMORY_ROOT_TITLE);
    const created = this.createdRoots.get(workspaceId);
    if (created && found.includes(created)) this.createdRoots.delete(workspaceId);
    const rootId = this.createdRoots.get(workspaceId) ?? found[0];
    if (!rootId) return { rootId: null, notes: [] };

    const access = this.ac.user(userId).workspace(workspaceId);
    if (!(await access.doc(rootId).can('Doc.Read'))) return null;
    const root = await this.reader.getDocMarkdown(workspaceId, rootId, false);
    if (!root) {
      // Unreadable rather than absent: skip, rather than start a second one.
      if (rootId === created) this.createdRoots.delete(workspaceId);
      return null;
    }

    const ids = linkedDocIds(root.markdown, rootId).slice(0, MAX_NOTES);
    const readable = ids.length
      ? await access.docs(ids.map(docId => ({ docId })), 'Doc.Read')
      : [];
    const notes: Memory['notes'] = [];
    for (const { docId } of readable) {
      const doc = await this.reader.getDocMarkdown(workspaceId, docId, false);
      const subject = doc?.title.trim();
      if (doc && subject) notes.push({ docId, subject, markdown: doc.markdown });
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
      this.contract = { responseSchemaJson: responseSchemaJson!, schemaHash: schemaHash! };
    }
    return this.contract;
  }
}
