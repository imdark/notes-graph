import type { RemoteJob } from '@notesgraph/core/modules/agents';

/**
 * What an empty log says while its run hasn't ended: where the run is, so a
 * queued run doesn't read as one that started and went quiet. Null once the
 * job has ended.
 */
export const waitingText = (
  status: RemoteJob['status'],
  {
    deviceKey,
    runAfter,
    now = Date.now(),
  }: {
    deviceKey?: string | null;
    /** Epoch seconds a queued job is held until (a session limit). */
    runAfter?: number | null;
    now?: number;
  } = {}
): string | null => {
  const device = deviceKey || 'the device';
  switch (status) {
    case 'held':
      return 'Held: the workspace’s prestart automations are checking this run…';
    case 'queued':
      return runAfter && runAfter * 1000 > now
        ? `Queued: ${device} hit its session limit; it runs again at ${new Date(runAfter * 1000).toLocaleString()}…`
        : `Queued: waiting for ${device} to pick this up…`;
    case 'running':
      return 'Running: waiting for its first output…';
    default:
      return null;
  }
};
