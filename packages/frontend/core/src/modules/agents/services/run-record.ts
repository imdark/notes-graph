import { filter, firstValueFrom, map, race, timer } from 'rxjs';

import type { AgentRunSessionService } from './run-session';

/** How long to wait for a started run to get its record. */
const RUN_RECORD_WAIT_MS = 15_000;

/**
 * The record of the session started for this agent on this block, once it
 * has one, so a button can open the run's window. A start that fails before
 * it has one rejects; one that ends first, or is slow, gives null.
 */
export function awaitRunRecord(
  sessions: AgentRunSessionService,
  agentId: string,
  blockId: string,
  running: Promise<void>
): Promise<string | null> {
  const recorded$ = sessions.sessions$.pipe(
    map(
      list =>
        list.find(
          session =>
            session.agentId === agentId &&
            session.target.kind === 'block' &&
            session.target.blockId === blockId &&
            session.runId
        )?.runId ?? null
    ),
    filter((runId): runId is string => !!runId)
  );
  return firstValueFrom(
    race(
      recorded$,
      timer(RUN_RECORD_WAIT_MS).pipe(map(() => null)),
      running.then(() => null)
    )
  );
}
