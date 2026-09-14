import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import { StdIdentifier } from '@blocksuite/std';
import { InlineSpecExtension } from '@blocksuite/std/inline';
import { html } from 'lit';
import { z } from 'zod';

export const LinkInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>('link', provider => {
    const std = provider.get(StdIdentifier);
    return {
      name: 'link',
      schema: z.object({
        link: z.string().optional().nullable().catch(undefined),
      }),
      match: delta => {
        return !!delta.attributes?.link;
      },
      renderer: ({ delta }) => {
        return html`<notesgraph-link
          .std=${std}
          .delta=${delta}
        ></notesgraph-link>`;
      },
    };
  });
