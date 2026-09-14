import {
  InlineDeltaToHtmlAdapterExtension,
  InlineDeltaToMarkdownAdapterExtension,
  InlineDeltaToPlainTextAdapterExtension,
} from '@blocksuite/notesgraph-shared/adapters';

/**
 * Serializes an org-status chip back to its org-mode plain-text form
 * (`[ ]`, `[-]`, `[X]`, `WAITING`…) — the chip embeds a placeholder
 * character in the document and carries the annotation in the attribute.
 */
export const orgStatusDeltaToMarkdownAdapterMatcher =
  InlineDeltaToMarkdownAdapterExtension({
    name: 'orgStatus',
    match: delta => typeof delta.attributes?.orgStatus === 'string',
    toAST: delta => ({
      type: 'text',
      value: delta.attributes?.orgStatus ?? delta.insert,
    }),
  });

export const orgStatusDeltaToPlainTextAdapterMatcher =
  InlineDeltaToPlainTextAdapterExtension({
    name: 'orgStatus',
    match: delta => typeof delta.attributes?.orgStatus === 'string',
    toAST: delta => ({
      content: delta.attributes?.orgStatus ?? delta.insert,
    }),
  });

export const orgStatusDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'orgStatus',
    match: delta => typeof delta.attributes?.orgStatus === 'string',
    toAST: delta => ({
      type: 'element',
      tagName: 'span',
      properties: { className: ['org-status'] },
      children: [
        {
          type: 'text',
          value: delta.attributes?.orgStatus ?? delta.insert,
        },
      ],
    }),
  });

/**
 * Org timestamps serialize back to their org syntax; in HTML they become
 * date metadata elements at their position in the line (the mirror writes
 * them at the end of the item text).
 */
export const orgTimestampDeltaToMarkdownAdapterMatcher =
  InlineDeltaToMarkdownAdapterExtension({
    name: 'orgTimestamp',
    match: delta => typeof delta.attributes?.orgTimestamp === 'string',
    toAST: delta => ({
      type: 'text',
      value: delta.attributes?.orgTimestamp ?? delta.insert,
    }),
  });

export const orgTimestampDeltaToPlainTextAdapterMatcher =
  InlineDeltaToPlainTextAdapterExtension({
    name: 'orgTimestamp',
    match: delta => typeof delta.attributes?.orgTimestamp === 'string',
    toAST: delta => ({
      content: delta.attributes?.orgTimestamp ?? delta.insert,
    }),
  });

export const orgTimestampDeltaToHtmlAdapterMatcher =
  InlineDeltaToHtmlAdapterExtension({
    name: 'orgTimestamp',
    match: delta => typeof delta.attributes?.orgTimestamp === 'string',
    toAST: delta => {
      const annotation = delta.attributes?.orgTimestamp ?? delta.insert;
      return {
        type: 'element',
        tagName: 'time',
        properties: {
          className: ['org-timestamp'],
          dataOrgTimestamp: annotation,
        },
        children: [{ type: 'text', value: annotation }],
      };
    },
  });
