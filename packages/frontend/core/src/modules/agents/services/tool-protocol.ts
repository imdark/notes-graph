import type { AgentToolSpec } from './file-tools';

/**
 * A text protocol for tool calls, rather than the provider's native
 * function-calling API.
 *
 * The on-device harness is WebLLM, whose default is a 1B Llama. Models that
 * small do not emit well-formed OpenAI tool-call payloads with any
 * reliability, and WebLLM's function-calling support varies by model. A fenced
 * block the model only has to *write* — not conform to a JSON schema in a
 * side-channel — degrades far better: a malformed block is recoverable by
 * telling the model what was wrong and letting it retry a step.
 *
 * When a cloud harness with real tool calling lands, this stays as the
 * fallback for the on-device path.
 */

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** ```tool ... ``` — tolerant of the whitespace small models sprinkle in. */
const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)```/i;

/** What the model is told about the folder tools, when it has them. */
export const FILE_TOOL_RULES = [
  'The file tools work with the files in the folder bound to this workspace.',
  'Read a file before overwriting it. Never invent file contents.',
];

/**
 * The tool section of a system prompt. `rules` are the extra instructions
 * that go with the tools on offer (see FILE_TOOL_RULES), so a run without
 * file tools isn't told about a folder it doesn't have.
 */
export function buildToolPrompt(
  tools: AgentToolSpec[],
  rules: string[] = []
): string {
  const lines = tools.map(tool => {
    const args = Object.entries(tool.args)
      .map(([key, hint]) => `"${key}": <${hint}>`)
      .join(', ');
    return `- ${tool.name}: ${tool.desc}\n  args: {${args}}`;
  });
  // A concrete call to copy, from a tool the run actually has.
  const example = tools[0];
  const exampleArg = example ? Object.keys(example.args)[0] : undefined;
  const exampleCall = example
    ? JSON.stringify({
        tool: example.name,
        args: exampleArg ? { [exampleArg]: '...' } : {},
      })
    : '{"tool": "<name>", "args": {}}';

  return [
    'You can use tools. The available tools are:',
    '',
    ...lines,
    '',
    'To use one, reply with ONLY a fenced block like this and nothing else:',
    '',
    '```tool',
    exampleCall,
    '```',
    '',
    'You will then be given the result and can use another tool or answer.',
    'When you are ready to answer, reply normally with no tool block.',
    ...rules,
  ].join('\n');
}

/**
 * The tool call in `text`, or null when the model is answering.
 *
 * Throws on a block that is present but unusable, so the caller can hand the
 * model the parse error and spend a step on a retry rather than silently
 * treating a broken call as a final answer.
 */
export function parseToolCall(text: string): ParsedToolCall | null {
  const match = TOOL_BLOCK_RE.exec(text);
  if (!match) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(match[1].trim());
  } catch {
    throw new Error(
      'That tool block was not valid JSON. Reply with a single ```tool block containing only JSON.'
    );
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('A tool block must contain a JSON object.');
  }

  const { tool, args } = payload as { tool?: unknown; args?: unknown };
  if (typeof tool !== 'string' || !tool) {
    throw new Error('A tool block needs a "tool" name.');
  }

  return {
    name: tool,
    args:
      typeof args === 'object' && args !== null
        ? (args as Record<string, unknown>)
        : {},
  };
}

/** Strip tool blocks so they never leak into the answer shown to the user. */
export function stripToolBlocks(text: string): string {
  return text.replace(/```tool\s*\n[\s\S]*?```/gi, '').trim();
}
