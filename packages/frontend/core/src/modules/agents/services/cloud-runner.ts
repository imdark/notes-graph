import { Service } from '@notesgraph/infra';
import { ServerFeature } from '@notesgraph/graphql';

import {
  CopilotClient,
  Endpoint,
} from '../../../blocksuite/ai/runtime/request/copilot-client';
import { textToText } from '../../../blocksuite/ai/runtime/request/message-transport';
import {
  EventSourceService,
  GraphQLService,
  type WorkspaceServerService,
} from '../../cloud';

/**
 * Runs an agent's model calls on the workspace's server, through the same
 * copilot the chat panel uses, instead of on the in-browser model.
 *
 * Only the model call moves: the loop, the tools and the transcript stay in
 * the tab, so a cloud agent behaves like an on-device one with a stronger
 * model behind it.
 */

/** The general-purpose server prompt; the agent's own instructions ride in the message. */
const PROMPT_NAME = 'Chat With NotesGraph AI';

/** A cloud model answers one step well inside this; a hung stream must still end. */
const STEP_TIMEOUT_MS = 5 * 60_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Stream the model's reply to a conversation. Called with the whole
 * conversation each step, the same shape the on-device model takes.
 */
export type ChatModel = (
  messages: ChatMessage[],
  signal: AbortSignal
) => AsyncIterable<string>;

/**
 * Turn the messages a server session hasn't seen yet into the one user
 * message it takes. The server keeps its own replies, so assistant turns are
 * skipped; the server prompt has its own system message, so the agent's is
 * sent as the opening part of the first turn.
 */
export function unsentCloudMessage(messages: ChatMessage[]): string {
  return messages
    .filter(m => m.role !== 'assistant')
    .map(m =>
      m.role === 'system'
        ? `<instructions>\n${m.content}\n</instructions>`
        : m.content
    )
    .join('\n\n');
}

export class CloudAgentRunnerService extends Service {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  /**
   * GraphQL and EventSource live in the server scope, not the workspace scope
   * this service is registered in, so they are reached through the
   * workspace's server rather than injected (see RemoteAgentRunnerService).
   */
  private client(): CopilotClient {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error(
        'This workspace is local, so there is no server to run a cloud agent on. Switch it to on-device in Settings → Agents.'
      );
    }
    if (!server.config$.value.features.includes(ServerFeature.Copilot)) {
      throw new Error(
        "This server has no AI model set up, so cloud agents can't run on it yet. An admin can turn on Copilot in the admin panel; until then, switch the agent to on-device or a remote device in Settings → Agents."
      );
    }
    return new CopilotClient(
      server.scope.get(GraphQLService).gql,
      server.scope.get(EventSourceService).eventSource
    );
  }

  /**
   * Open a server conversation for one run. Each call to the returned model
   * sends only the messages added since the last call, since earlier turns
   * are already in the server's session.
   */
  async open(workspaceId: string): Promise<ChatModel> {
    const client = this.client();
    const sessionId = await client.createSession({
      workspaceId,
      promptName: PROMPT_NAME,
      pinned: false,
      // Each run is its own conversation; never continue the reader's chat.
      reuseLatestChat: false,
    });
    let sent = 0;
    return (messages, signal) => {
      const content = unsentCloudMessage(messages.slice(sent));
      sent = messages.length;
      return textToText({
        client,
        sessionId,
        workspaceId,
        content,
        stream: true,
        signal,
        timeout: STEP_TIMEOUT_MS,
        endpoint: Endpoint.Stream,
      }) as AsyncIterable<string>;
    };
  }
}
