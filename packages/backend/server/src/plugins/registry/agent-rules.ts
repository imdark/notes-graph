import { Injectable, Logger } from '@nestjs/common';

import { DocReader } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import type { AgentProfile } from './agent-profiles';

/**
 * The user's own rules for agents, kept as a note in the workspace like an
 * AGENTS.md: where research goes, how notes are named, which tags to use.
 * The system prompt in agent-profiles.ts carries the defaults; this note is
 * how the user changes them without a deploy. Every run reads it when it
 * starts, so an edit applies from the next run on.
 *
 * The in-tab executor (frontend agents/services/agent-rules.ts) reads the
 * same note by the same title and words it the same way.
 */
export const AGENT_RULES_TITLE = 'Agent rules';

/**
 * Longest rules text handed to a run, in characters. The note goes into
 * every run's system prompt, so a note that grew into a journal mustn't
 * crowd out the task; the tail is cut and the agent told so.
 */
export const MAX_AGENT_RULES_CHARS = 8_000;

/**
 * The rules as a system-prompt section, or null for a note with nothing in
 * it. They come after the built-in conventions and are said to win, since
 * the point of the note is to override them.
 */
export function agentRulesSection(markdown: string | null | undefined) {
  const text = markdown?.trim();
  if (!text) return null;
  const clipped = text.length > MAX_AGENT_RULES_CHARS;
  return [
    `The user keeps rules for agents in their note titled "${AGENT_RULES_TITLE}".`,
    'Follow them; where they differ from the conventions above, they win.',
    '',
    '<agent-rules>',
    clipped ? text.slice(0, MAX_AGENT_RULES_CHARS) : text,
    ...(clipped ? ['[the rest of the note was cut]'] : []),
    '</agent-rules>',
  ].join('\n');
}

/** A profile with the rules appended to its system prompt; as is without. */
export function withAgentRules(
  profile: AgentProfile,
  markdown: string | null | undefined
): AgentProfile {
  const section = agentRulesSection(markdown);
  if (!section) return profile;
  return { ...profile, systemPrompt: `${profile.systemPrompt}\n${section}\n` };
}

/**
 * Finds and reads the workspace's "Agent rules" note for a run. Nothing here
 * may fail the claim it rides on: a note that can't be read is logged and
 * the run goes without it, as it would with no note at all.
 */
@Injectable()
export class AgentRules {
  private readonly logger = new Logger(AgentRules.name);

  constructor(
    private readonly models: Models,
    private readonly reader: DocReader,
    private readonly ac: PermissionAccess
  ) {}

  /**
   * The note's markdown, or null. A run reads it as whoever started it, so a
   * note they can't open isn't put in front of their agent; a job the server
   * queued itself has no one to check for. With more than one note of that
   * title, the first that has anything in it is used.
   */
  async read(workspaceId: string, userId?: string | null) {
    try {
      const ids = await this.models.doc.findIdsByTitle(
        workspaceId,
        AGENT_RULES_TITLE
      );
      for (const docId of ids) {
        if (userId) {
          const allowed = await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .can('Doc.Read');
          if (!allowed) continue;
        }
        const doc = await this.reader.getDocMarkdown(workspaceId, docId, false);
        const markdown = doc?.markdown.trim();
        if (markdown) return markdown;
      }
    } catch (err) {
      this.logger.warn(
        `couldn't read the agent rules in ${workspaceId}: ${(err as Error).message}`
      );
    }
    return null;
  }
}
