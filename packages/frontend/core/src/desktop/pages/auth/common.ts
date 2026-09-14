import { z } from 'zod';

export const supportedClient = z.enum([
  'web',
  'notesgraph',
  'notesgraph-canary',
  'notesgraph-beta',
  ...(BUILD_CONFIG.debug ? ['notesgraph-dev'] : []),
]);
