import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    docService: {
      endpoint: string;
      enrichment: {
        enabled: boolean;
      };
    };
  }
}

defineModuleConfig('docService', {
  endpoint: {
    desc: 'The endpoint of the doc service.',
    default: '',
    env: 'DOC_SERVICE_ENDPOINT',
  },
  'enrichment.enabled': {
    desc: 'Run the nightly enrichment that titles untitled notes from their first sentence and flags empty ones. Off by default: it rewrites note titles across every workspace.',
    default: false,
    env: ['NOTESGRAPH_DOC_ENRICHMENT_ENABLED', 'boolean'],
  },
});
