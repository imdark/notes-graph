import {
  type LlmBackendConfig,
  llmDispatchToolLoopStream,
  llmDispatchToolLoopStreamPrepared,
  llmDispatchToolLoopStreamRouted,
  type LlmPreparedDispatchRoute,
  type LlmProtocol,
  type LlmRequest,
  type LlmRoutedBackend,
  type LlmToolCallbackRequest,
  type LlmToolCallbackResponse,
  type LlmToolLoopStreamEvent,
} from '../../../../native';
import type {
  CopilotTool,
  CopilotToolExecuteOptions,
  CopilotToolSet,
} from '../../tools';

export type ToolLoopDispatch = (
  request: LlmRequest,
  signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
  maybeMessages?: CopilotToolExecuteOptions['messages']
) => AsyncIterableIterator<LlmToolLoopStreamEvent>;

export type ToolLoopBackend =
  | { protocol: LlmProtocol; backendConfig: LlmBackendConfig }
  | { routes: LlmRoutedBackend[] }
  | { preparedRoutes: LlmPreparedDispatchRoute[] };

function normalizeToolExecuteOptions(
  signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
  maybeMessages?: CopilotToolExecuteOptions['messages']
): CopilotToolExecuteOptions {
  if (
    signalOrOptions &&
    typeof signalOrOptions === 'object' &&
    'aborted' in signalOrOptions
  ) {
    return {
      signal: signalOrOptions,
      messages: maybeMessages,
    };
  }

  if (!signalOrOptions) {
    return maybeMessages ? { messages: maybeMessages } : {};
  }

  return {
    ...signalOrOptions,
    signal: signalOrOptions.signal,
    messages: signalOrOptions.messages ?? maybeMessages,
  };
}

export function createToolExecutionCallback(
  tools: CopilotToolSet,
  options: CopilotToolExecuteOptions = {}
) {
  return async (request: LlmToolCallbackRequest) => {
    return await executeToolCall(tools, request, options);
  };
}

async function executeToolCall(
  tools: CopilotToolSet,
  request: LlmToolCallbackRequest,
  options: CopilotToolExecuteOptions
): Promise<LlmToolCallbackResponse> {
  const tool = tools[request.name] as CopilotTool | undefined;

  if (!tool?.execute) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: { message: `Tool not found: ${request.name}` },
    };
  }

  if (request.argumentParseError) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: {
        message: 'Invalid tool arguments JSON',
        ...(request.rawArgumentsText
          ? { rawArguments: request.rawArgumentsText }
          : {}),
        ...(request.argumentParseError
          ? { error: request.argumentParseError }
          : {}),
      },
    };
  }

  try {
    const output = await tool.execute(request.args, options);
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      output: (output ?? null) as LlmToolCallbackResponse['output'],
    };
  } catch (error) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      output: {
        message: error instanceof Error ? error.message : String(error),
      },
      isError: true,
    };
  }
}

/** Tools that look something up, whose repeat with the same args is skipped. */
const SEARCH_TOOLS = new Set([
  'doc_semantic_search',
  'doc_keyword_search',
  'web_search_exa',
]);

const normalizeArg = (value: unknown): unknown =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : Array.isArray(value)
      ? value.map(normalizeArg)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, normalizeArg(item)])
          )
        : value;

/**
 * The tool callback for one loop, answering a search it already ran from
 * memory: a model that repeats a query word for word learns nothing new, so
 * it is told to look at the earlier result rather than spending a call.
 */
export function createDedupingToolExecutionCallback(
  tools: CopilotToolSet,
  options: CopilotToolExecuteOptions = {}
) {
  const execute = createToolExecutionCallback(tools, options);
  const searched = new Set<string>();
  return async (
    request: LlmToolCallbackRequest
  ): Promise<LlmToolCallbackResponse> => {
    if (SEARCH_TOOLS.has(request.name) && !request.argumentParseError) {
      const key = `${request.name}:${JSON.stringify(normalizeArg(request.args))}`;
      if (searched.has(key)) {
        const query = (request.args as { query?: unknown } | undefined)?.query;
        const label = typeof query === 'string' ? `"${query.trim()}"` : 'this';
        return {
          callId: request.callId,
          name: request.name,
          args: request.args,
          rawArgumentsText: request.rawArgumentsText,
          argumentParseError: request.argumentParseError,
          output: {
            message: `Already searched for ${label} — see the earlier result.`,
          },
        };
      }
      searched.add(key);
    }
    return await execute(request);
  };
}

export function createToolLoopBridge(
  backend: ToolLoopBackend,
  tools: CopilotToolSet,
  maxSteps = 20
): ToolLoopDispatch {
  return (
    request: LlmRequest,
    signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
    maybeMessages?: CopilotToolExecuteOptions['messages']
  ) => {
    const toolExecuteOptions = normalizeToolExecuteOptions(
      signalOrOptions,
      maybeMessages
    );
    const execute = createDedupingToolExecutionCallback(
      tools,
      toolExecuteOptions
    );
    const toolLoopRequest = { ...request, stream: true };

    if ('routes' in backend) {
      return llmDispatchToolLoopStreamRouted(
        backend.routes,
        toolLoopRequest,
        execute,
        maxSteps,
        toolExecuteOptions.signal
      );
    }

    if ('preparedRoutes' in backend) {
      return llmDispatchToolLoopStreamPrepared(
        backend.preparedRoutes,
        execute,
        maxSteps,
        toolExecuteOptions.signal
      );
    }

    return llmDispatchToolLoopStream(
      backend.protocol,
      backend.backendConfig,
      toolLoopRequest,
      execute,
      maxSteps,
      toolExecuteOptions.signal
    );
  };
}
