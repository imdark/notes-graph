import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

describe('admin global token mapping', () => {
  test('maps semantic colors to notesgraph tokens', () => {
    expect(css).toContain(
      '--background: var(--notesgraph-v2-layer-background-primary);'
    );
    expect(css).toContain('--foreground: var(--notesgraph-v2-text-primary);');
    expect(css).toContain('--primary: var(--notesgraph-v2-button-primary);');
    expect(css).toContain('--ring: var(--notesgraph-v2-input-border-active);');
    expect(css).toContain('--radius: var(--notesgraph-popover-radius);');
  });

  test('does not keep hardcoded shadcn light/dark values', () => {
    expect(css).not.toContain('--background: 0 0% 100%;');
    expect(css).not.toContain('--foreground: 240 10% 3.9%;');
    expect(css).not.toContain('--background: 240 10% 3.9%;');
  });

  test('supports data-theme based dark variant', () => {
    expect(css).toContain("[data-theme='dark']");
  });
});
