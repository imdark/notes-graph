import { useI18n } from '@notesgraph/i18n';
import { useEffect, useState } from 'react';

import * as styles from './index.css';

const PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the app's server answers. Any HTTP response counts: it means the
 * request went out and came back. Only a network error or a timeout is
 * "unreachable".
 */
const probeServer = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch('/info', { cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Live connectivity: `navigator.onLine` and the online/offline window events,
 * checked against the server. Chrome can get stuck reporting offline after
 * the machine changes networks, in every tab and across reloads, while
 * requests go through fine. So "offline" from the browser is only believed
 * once a request to the server also fails, and it is re-checked every 15s
 * until either side says online. SSR-safe default of online.
 */
export const useNetworkOnline = () => {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      clearTimeout(timer);
      if (navigator.onLine) {
        setOnline(true);
        return;
      }
      const reachable = await probeServer();
      if (disposed) return;
      setOnline(reachable);
      if (!navigator.onLine) {
        timer = setTimeout(onChange, PROBE_INTERVAL_MS);
      }
    };

    // check() never rejects (probeServer catches), the catch is for lint.
    const onChange = () => {
      check().catch(() => {});
    };
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    onChange();
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);
  return online;
};

/**
 * Sidebar footer indicator: a coloured dot (green online / red offline) with
 * an "Online" / "Offline" label next to it, so the user always knows whether
 * edits are syncing or staying local until the connection returns.
 */
export const NetworkStatus = () => {
  const t = useI18n();
  const online = useNetworkOnline();

  const label = online
    ? t['com.notesgraph.rootAppSidebar.network.online']()
    : t['com.notesgraph.rootAppSidebar.network.offline']();

  return (
    <div
      className={styles.root}
      data-online={online}
      data-testid="network-status"
      title={label}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
    </div>
  );
};
