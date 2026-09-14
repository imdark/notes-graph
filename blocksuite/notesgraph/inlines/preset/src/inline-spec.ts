import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import {
  type InlineRootElement,
  InlineSpecExtension,
} from '@blocksuite/std/inline';
import type { ExtensionType } from '@blocksuite/store';
import { html } from 'lit';
import { z } from 'zod';

export type NotesGraphInlineRootElement =
  InlineRootElement<NotesGraphTextAttributes>;

export const BoldInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'bold',
    schema: z.object({
      bold: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.bold;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const ItalicInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'italic',
    schema: z.object({
      italic: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.italic;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const UnderlineInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'underline',
    schema: z.object({
      underline: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.underline;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const StrikeInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'strike',
    schema: z.object({
      strike: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.strike;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const CodeInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'inline-code',
    schema: z.object({
      code: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.code;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const BackgroundInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'background',
    schema: z.object({
      background: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.background;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const ColorInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'color',
    schema: z.object({
      color: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return !!delta.attributes?.color;
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const OrgStatusInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'org-status',
    schema: z.object({
      orgStatus: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return typeof delta.attributes?.orgStatus === 'string';
    },
    renderer: ({ delta, selected, editor, startOffset, endOffset }) => {
      return html`<notesgraph-org-status
        .delta=${delta}
        .selected=${selected}
        .editor=${editor}
        .startOffset=${startOffset}
        .endOffset=${endOffset}
      ></notesgraph-org-status>`;
    },
    embed: true,
  });

export const OrgTimestampInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'org-timestamp',
    schema: z.object({
      orgTimestamp: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return typeof delta.attributes?.orgTimestamp === 'string';
    },
    renderer: ({ delta, selected, editor, startOffset, endOffset }) => {
      return html`<notesgraph-org-timestamp
        .delta=${delta}
        .selected=${selected}
        .editor=${editor}
        .startOffset=${startOffset}
        .endOffset=${endOffset}
      ></notesgraph-org-timestamp>`;
    },
    embed: true,
  });

export const OrgTagInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'org-tag',
    schema: z.object({
      orgTag: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return typeof delta.attributes?.orgTag === 'string';
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const OrgMentionInlineSpecExtension =
  InlineSpecExtension<NotesGraphTextAttributes>({
    name: 'org-mention',
    schema: z.object({
      orgMention: z.string().optional().nullable().catch(undefined),
    }),
    match: delta => {
      return typeof delta.attributes?.orgMention === 'string';
    },
    renderer: ({ delta }) => {
      return html`<notesgraph-text .delta=${delta}></notesgraph-text>`;
    },
  });

export const InlineSpecExtensions: ExtensionType[] = [
  OrgStatusInlineSpecExtension,
  OrgTimestampInlineSpecExtension,
  OrgTagInlineSpecExtension,
  OrgMentionInlineSpecExtension,
  BoldInlineSpecExtension,
  ItalicInlineSpecExtension,
  UnderlineInlineSpecExtension,
  StrikeInlineSpecExtension,
  CodeInlineSpecExtension,
  BackgroundInlineSpecExtension,
  ColorInlineSpecExtension,
];
