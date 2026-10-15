import type { Agent } from '../stores/agents';
import type { AgentContext } from './context';

/**
 * "Compile into my notes": a note that came in from outside — a page the web
 * clipper saved, a Readwise highlight — is read by an agent that files what
 * it says into the rest of the user's notes, the way a person would after
 * reading it: a short summary note, the new facts added to the concept and
 * person notes they already have, and notes for the concepts that had none.
 *
 * This file is the part that needs no app: which notes count as a source,
 * and what the agent is told about the one it is on. The instructions are
 * the Compile template's (agent-templates.ts); the button is in the note's
 * agents panel.
 */

/** Where a source note came from, as far as the note itself records. */
export interface CompileSource {
  /** `clip` is the web clipper; `readwise` the Readwise import. */
  kind: 'clip' | 'readwise';
  /** The original's address, to cite; absent when the import didn't keep one. */
  url?: string;
  /** Who wrote the original, when the import knows. */
  author?: string;
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * The source a note was made from, read from its doc properties; null for a
 * note the user wrote. The clipper stamps `clipSource` on what it imports,
 * and the Readwise import sets `integrationType` with the highlight's and
 * book's fields under `readwise:` keys (IntegrationPropertyService). For
 * Readwise the book's own address is preferred to the highlight's page on
 * readwise.io, which is only a way back to the highlight.
 */
export function compileSourceOf(
  properties: Record<string, unknown> | null | undefined
): CompileSource | null {
  if (!properties) return null;
  if (properties.integrationType === 'readwise') {
    return {
      kind: 'readwise',
      url:
        nonEmpty(properties['readwise:source_url']) ??
        nonEmpty(properties['readwise:readwise_url']),
      author: nonEmpty(properties['readwise:author']),
    };
  }
  const clip = properties.clipSource;
  if (clip && typeof clip === 'object') {
    return {
      kind: 'clip',
      url: nonEmpty((clip as { url?: unknown }).url),
    };
  }
  return null;
}

/**
 * What a Compile run reads: the source note as the run would have read it
 * anyway, under a header that says which note it is (its docId, to link the
 * new notes to it and cite it by) and where the original lives. A whole-note
 * run isn't otherwise told its own docId.
 */
export function compileBrief(
  context: AgentContext,
  docId: string,
  source: CompileSource
): AgentContext {
  const from =
    source.kind === 'readwise' ? 'a Readwise highlight' : 'a web clip';
  const header = [
    '## Source to compile',
    '',
    `- Note: docId ${docId} (${from})`,
    source.url ? `- Original: ${source.url}` : '- Original: not recorded',
    ...(source.author ? [`- Author: ${source.author}`] : []),
    '',
    'Compile this source into the notes, as your instructions say. Cite it',
    `by linking this note (docId ${docId})${source.url ? ' and the original' : ''}.`,
  ].join('\n');
  return {
    ...context,
    label: `compile ${context.label}`,
    text: `${header}\n\n${context.text}`,
  };
}

/** The name the Compile template saves its agent under. */
export const COMPILE_AGENT_NAME = 'Compile into my notes';

/**
 * The agent the "Compile into my notes" button runs: one made from the
 * template, found by its name, or by its instructions if it was renamed.
 * Undefined when there is none yet, and the button makes one.
 */
export function findCompileAgent(
  agents: Agent[],
  instructions: string
): Agent | undefined {
  return (
    agents.find(agent => agent.name === COMPILE_AGENT_NAME) ??
    agents.find(agent => agent.instructions === instructions)
  );
}
