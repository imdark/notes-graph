import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    doc: {
      history: {
        interval: number;
      };
      experimental: {
        yocto: boolean;
      };
      nativeMergeMinBytes: number;
    };
  }
}

defineModuleConfig('doc', {
  'experimental.yocto': {
    desc: 'Use `y-octo` to merge updates at the same time when merging using Yjs.',
    default: false,
  },
  nativeMergeMinBytes: {
    desc: 'Merge a doc whose pending updates total at least this many bytes with the native codec on a worker thread, so a large doc does not block other requests while it merges. Falls back to Yjs on any error. 0 turns it off.',
    default: 256 * 1024,
  },
  'history.interval': {
    desc: 'The minimum time interval in milliseconds of creating a new history snapshot when doc get updated.',
    default: 1000 * 60 * 10 /* 10 mins */,
  },
});
