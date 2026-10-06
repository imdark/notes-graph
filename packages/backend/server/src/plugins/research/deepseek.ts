import { Injectable, Logger } from '@nestjs/common';

import { Config } from '../../base';

/**
 * DeepSeek models an agent may run on through this server. `deepseek-chat`
 * is the general model; `deepseek-reasoner` thinks before it answers, which
 * suits reading and weighing papers but is slower.
 */
export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * The answer text in one line of DeepSeek's (OpenAI-style) SSE stream, or
 * null for a line that carries none: keep-alives, the `[DONE]` marker, and
 * the reasoner's thinking, which is not part of the answer.
 */
export function sseDelta(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  const chunk = JSON.parse(data);
  if (chunk?.error) {
    throw new Error(`DeepSeek: ${chunk.error.message ?? 'stream failed'}`);
  }
  const content = chunk?.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content ? content : null;
}

/** Messages as the client sent them, kept to the shape DeepSeek takes. */
export function cleanMessages(messages: unknown): DeepSeekMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap(message =>
    message &&
    ['system', 'user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string'
      ? [{ role: message.role, content: message.content }]
      : []
  );
}

/**
 * A minimal client for DeepSeek's chat completions API, so an agent can run
 * on DeepSeek without the key ever reaching the browser.
 */
@Injectable()
export class DeepSeekClient {
  private readonly logger = new Logger(DeepSeekClient.name);

  constructor(private readonly config: Config) {}

  get configured(): boolean {
    return !!this.config.research.deepseekApiKey;
  }

  /** Stream the answer to a conversation, as text deltas. */
  async *chat(
    model: string,
    messages: DeepSeekMessage[],
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const { deepseekUrl, deepseekApiKey } = this.config.research;
    const started = Date.now();
    const response = await fetch(
      `${deepseekUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      }
    );
    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(
        `DeepSeek answered ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const delta = sseDelta(line);
        if (delta) yield delta;
      }
    }
    const delta = sseDelta(buffer);
    if (delta) yield delta;
    this.logger.log(`${model} in ${Date.now() - started}ms`);
  }
}
