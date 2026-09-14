import { z } from 'zod';

export const appSchemes = z.enum([
  'notesgraph',
  'notesgraph-canary',
  'notesgraph-beta',
  'notesgraph-internal',
  'notesgraph-dev',
]);

export type Scheme = z.infer<typeof appSchemes>;
export type Channel = 'stable' | 'canary' | 'beta' | 'internal';

export const schemeToChannel = {
  notesgraph: 'stable',
  'notesgraph-canary': 'canary',
  'notesgraph-beta': 'beta',
  'notesgraph-internal': 'internal',
  'notesgraph-dev': 'canary', // dev does not have a dedicated app. use canary as the placeholder.
} as Record<Scheme, Channel>;

export const channelToScheme = {
  stable: 'notesgraph',
  canary: BUILD_CONFIG.debug ? 'notesgraph-dev' : 'notesgraph-canary',
  beta: 'notesgraph-beta',
  internal: 'notesgraph-internal',
} as Record<Channel, Scheme>;

export const appIconMap = {
  stable: '/imgs/app-icon-stable.ico',
  canary: '/imgs/app-icon-canary.ico',
  beta: '/imgs/app-icon-beta.ico',
  internal: '/imgs/app-icon-internal.ico',
} satisfies Record<Channel, string>;

export const appNames = {
  stable: 'NotesGraph',
  canary: 'NotesGraph Canary',
  beta: 'NotesGraph Beta',
  internal: 'NotesGraph Internal',
} satisfies Record<Channel, string>;

export const appSchemaUrl = z.custom<string>(
  (url: string) => {
    try {
      return appSchemes.safeParse(new URL(url).protocol.replace(':', ''))
        .success;
    } catch {
      return false;
    }
  },
  { message: 'Invalid URL or protocol' }
);
