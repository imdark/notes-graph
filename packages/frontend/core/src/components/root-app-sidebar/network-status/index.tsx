import { useI18n } from '@notesgraph/i18n';
import { useEffect, useState } from 'react';

import * as styles from './index.css';

/**
 * Live browser connectivity, from `navigator.onLine` + the online/offline
 * window events. This is network reachability (not cloud-sync state) — the
 * signal users mean by "am I offline?". SSR-safe default of online.
 */
export const useNetworkOnline = () => {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
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
