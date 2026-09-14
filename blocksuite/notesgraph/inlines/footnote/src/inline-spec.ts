import { FootNoteSchema } from '@blocksuite/notesgraph-model';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import { StdIdentifier } from '@blocksuite/std';
import { InlineSpecExtension } from '@blocksuite/std/inline';
import { html } from 'lit';
import z from 'zod';

import { FootNoteNodeConfigIdentifier } from './footnote-node/footnote-config';

export const FootNoteInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>('footnote', provider => {
    const std = provider.get(StdIdentifier);
    const config =
      provider.getOptional(FootNoteNodeConfigIdentifier) ?? undefined;
    return {
      name: 'footnote',
      schema: z.object({
        footnote: FootNoteSchema.optional().nullable().catch(undefined),
      }),
      match: delta => {
        return !!delta.attributes?.footnote;
      },
      renderer: ({ delta }) => {
        return html`<notesgraph-footnote-node
          .delta=${delta}
          .std=${std}
          .config=${config}
        ></notesgraph-footnote-node>`;
      },
      embed: true,
    };
  });
