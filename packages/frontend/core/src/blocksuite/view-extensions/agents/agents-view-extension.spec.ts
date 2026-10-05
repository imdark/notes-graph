/**
 * @vitest-environment happy-dom
 */
import { Container } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { AgentsViewExtension } from '.';

/** Everything the agents view registers into a page editor. */
const registered = () => {
  const extensions: ExtensionType[] = [];
  const context: any = {
    scope: 'page',
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
});
