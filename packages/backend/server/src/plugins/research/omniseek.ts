import { Injectable, Logger } from '@nestjs/common';

import { Config } from '../../base';

/**
 * OmniSeek tools an agent may call through this server. They search and
 * read; the curator, sensor, ruling and statement tools change OmniSeek's
 * own state, and view/transcribe need the Research tier the sidecar lacks,
 * so none of those are offered.
 */
export const RESEARCH_TOOLS = [
  'omniseek_search',
  'omniseek_read',
  'omniseek_gather',
  'omniseek_sources',
  'omniseek_graph',
  'omniseek_paper_enrich',
  'omniseek_paper_recommend',
  'omniseek_field_skeleton',
];

/** How much of one tool result goes back to the model. */
export const MAX_RESULT_CHARS = 40_000;
/** Tool lists change only when OmniSeek is redeployed. */
const TOOLS_TTL_MS = 10 * 60_000;

export interface ResearchTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** A tool result's text parts, joined and capped for the model. */
export function resultText(result: any): string {
  const parts: any[] = Array.isArray(result?.content) ? result.content : [];
  const text = parts
    .map(part =>
      part?.type === 'text' ? String(part.text ?? '') : JSON.stringify(part)
    )
    .join('\n')
    .trim();
  const body = result?.isError ? `Error: ${text || 'the tool failed'}` : text;
  return body.length > MAX_RESULT_CHARS
    ? `${body.slice(0, MAX_RESULT_CHARS - 1)}…`
    : body;
}

/**
 * The JSON-RPC reply in an MCP streamable-HTTP response, which is either
 * plain JSON or a short SSE stream whose `data:` lines carry it.
 */
export function rpcReply(body: string, contentType: string): any {
  if (!contentType.includes('text/event-stream')) {
    return JSON.parse(body);
  }
  const data = body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean);
  for (const chunk of data.reverse()) {
    const message = JSON.parse(chunk);
    if ('result' in message || 'error' in message) return message;
  }
  throw new Error('OmniSeek sent no reply');
}

/**
 * A minimal client for OmniSeek's MCP endpoint. Its streamable-HTTP server
 * is stateless, so each call is one POST with no session to keep.
 */
@Injectable()
export class OmniSeekClient {
  private readonly logger = new Logger(OmniSeekClient.name);
  private tools: { at: number; list: ResearchTool[] } | null = null;
  private nextId = 0;

  constructor(private readonly config: Config) {}

  get configured(): boolean {
    return !!this.config.research.omniseekUrl;
  }

  private async rpc(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<any> {
    const { omniseekUrl, omniseekToken } = this.config.research;
    const response = await fetch(`${omniseekUrl.replace(/\/$/, '')}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(omniseekToken ? { Authorization: `Bearer ${omniseekToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.nextId,
        method,
        params,
      }),
      signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OmniSeek answered ${response.status}: ${body.slice(0, 200)}`);
    }
    const reply = rpcReply(body, response.headers.get('content-type') ?? '');
    if (reply.error) {
      throw new Error(`OmniSeek: ${reply.error.message ?? 'request failed'}`);
    }
    return reply.result;
  }

  /** The allowlisted tools OmniSeek has, with their schemas. */
  async listTools(signal?: AbortSignal): Promise<ResearchTool[]> {
    if (this.tools && Date.now() - this.tools.at < TOOLS_TTL_MS) {
      return this.tools.list;
    }
    const result = await this.rpc('tools/list', {}, signal);
    const list: ResearchTool[] = (result?.tools ?? [])
      .filter((tool: any) => RESEARCH_TOOLS.includes(tool.name))
      .map((tool: any) => ({
        name: tool.name,
        description: String(tool.description ?? ''),
        inputSchema: tool.inputSchema ?? {},
      }));
    this.tools = { at: Date.now(), list };
    return list;
  }

  /** Run one tool and return its text, as the model will read it. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const started = Date.now();
    const result = await this.rpc(
      'tools/call',
      { name, arguments: args },
      signal
    );
    this.logger.log(`${name} in ${Date.now() - started}ms`);
    return resultText(result);
  }
}
