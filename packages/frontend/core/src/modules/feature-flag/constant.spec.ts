import { describe, expect, test } from 'vitest';

import { NOTESGRAPH_FLAGS } from './constant';

describe('NOTESGRAPH_FLAGS', () => {
  test.each(Object.entries(NOTESGRAPH_FLAGS))(
    '%s carries the commit that added it',
    (_key, flag) => {
      // Empty means it was never stamped: run scripts/stamp-feature-flags.mjs.
      expect(flag.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  );
});
