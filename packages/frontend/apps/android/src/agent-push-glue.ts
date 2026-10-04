import { ServersService } from '@notesgraph/core/modules/cloud';
import type { FrameworkProvider } from '@notesgraph/infra';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

import { AgentPush } from './plugins/agent-push';

/**
 * Keep this phone registered for agent pushes with every server it is
 * signed in to: when a run started there needs a permission or an answer,
 * the phone gets a notification it can answer from (see push/ in the
 * Android app). Sign-out unregisters (app.tsx); a server dropped from the
 * list here is also ignored natively if it pushes anyway.
 */
export function setupAgentPush(framework: FrameworkProvider) {
  const serversService = framework.get(ServersService);

  const subscription = serversService.serversWithAccount$
    .pipe(
      map(list =>
        list
          .filter(({ account }) => !!account)
          .map(({ server }) => server.baseUrl)
          .sort()
      ),
      distinctUntilChanged((a, b) => a.join('\n') === b.join('\n')),
      debounceTime(1000)
    )
    .subscribe(servers => {
      // Signed out everywhere: nothing to hear about, and no reason to ask
      // for the notification permission yet.
      if (servers.length === 0) return;
      AgentPush.register({ servers }).catch(error => {
        console.error('[agent-push] failed to register', error);
      });
    });

  return () => subscription.unsubscribe();
}
