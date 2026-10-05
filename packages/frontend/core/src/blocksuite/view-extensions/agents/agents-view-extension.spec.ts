/**
 * @vitest-environment happy-dom
 */
import { Container } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { AgentsViewExtension } from '.';

/** Everything the agents view registers into an editor of the given scope. */
const registered = (scope = 'page') => {
  const extensions: ExtensionType[] = [];
  const context: any = {
    scope,
    register: (ext: ExtensionType | ExtensionType[]) =>
      extensions.push(...[ext].flat()),
  };
  new AgentsViewExtension().setup(context, {
    framework: new Framework().provider(),
  });
  return extensions;
};

describe('AgentsViewExtension', () => {
  test('sets up in one editor container without a duplicate binding', () => {
    // Two widgets once each bound the same framework identifier; the editor's
    // DI threw DuplicateServiceDefinitionError and no note page could open.
    const container = new Container();
    expect(() => {
      for (const ext of registered()) ext.setup?.(container);
    }).not.toThrow();
  });

  test('puts the block widgets in the phone editor too', () => {
    // The phone's editor runs in mobile-page; its to-do lines once got no
    // assign button because only 'page' and 'edgeless' registered them.
    expect(registered('mobile-page').length).toBe(registered('page').length);
    expect(registered('preview-page').length).toBeLessThan(
      registered('page').length
    );
  });
});
