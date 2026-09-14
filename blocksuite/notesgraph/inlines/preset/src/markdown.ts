import { LatexExtension } from '@blocksuite/notesgraph-inline-latex';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import { InlineMarkdownExtension } from '@blocksuite/std/inline';
import type { ExtensionType } from '@blocksuite/store';

// inline markdown match rules:
// covert: ***test*** + space
// covert: ***t est*** + space
// not convert: *** test*** + space
// not convert: ***test *** + space
// not convert: *** test *** + space

export const BoldItalicMarkdown =
  InlineMarkdownExtension<NotesGraphTextAttributes>({
    name: 'bolditalic',
    pattern: /.*\*{3}([^\s*][^*]*[^\s*])\*{3}\s$|.*\*{3}([^\s*])\*{3}\s$/,
    action: ({
      inlineEditor,
      prefixText,
      inlineRange,
      pattern,
      undoManager,
    }) => {
      const match = prefixText.match(pattern);
      if (!match) return;

      const targetText = match[1] ?? match[2];
      const annotatedText = match[0].slice(
        -(targetText.length + 3 * 2 + 1),
        -1
      );
      const startIndex = inlineRange.index - annotatedText.length - 1;

      undoManager.stopCapturing();

      inlineEditor.formatText(
        {
          index: startIndex,
          length: annotatedText.length,
        },
        {
          bold: true,
          italic: true,
        }
      );

      inlineEditor.deleteText({
        index: inlineRange.index - 4,
        length: 4,
      });
      inlineEditor.deleteText({
        index: startIndex,
        length: 3,
      });
      inlineEditor.setInlineRange({
        index: startIndex + annotatedText.length - 6,
        length: 0,
      });
    },
  });

export const BoldMarkdown = InlineMarkdownExtension<NotesGraphTextAttributes>({
  name: 'bold',
  pattern: /.*\*{2}([^\s][^*]*[^\s*])\*{2}\s$|.*\*{2}([^\s*])\*{2}\s$/,
  action: ({ inlineEditor, prefixText, inlineRange, pattern, undoManager }) => {
    const match = prefixText.match(pattern);
    if (!match) return;

    const targetText = match[1] ?? match[2];
    const annotatedText = match[0].slice(-(targetText.length + 2 * 2 + 1), -1);
    const startIndex = inlineRange.index - annotatedText.length - 1;

    undoManager.stopCapturing();

    inlineEditor.formatText(
      {
        index: startIndex,
        length: annotatedText.length,
      },
      {
        bold: true,
      }
    );

    inlineEditor.deleteText({
      index: inlineRange.index - 3,
      length: 3,
    });
    inlineEditor.deleteText({
      index: startIndex,
      length: 2,
    });
    inlineEditor.setInlineRange({
      index: startIndex + annotatedText.length - 4,
      length: 0,
    });
  },
});

export const ItalicExtension =
  InlineMarkdownExtension<NotesGraphTextAttributes>({
    name: 'italic',
    pattern: /.*\*{1}([^\s][^*]*[^\s*])\*{1}\s$|.*\*{1}([^\s*])\*{1}\s$/,
    action: ({
      inlineEditor,
      prefixText,
      inlineRange,
      pattern,
      undoManager,
    }) => {
      const match = prefixText.match(pattern);
      if (!match) return;

      const targetText = match[1] ?? match[2];
      const annotatedText = match[0].slice(
        -(targetText.length + 1 * 2 + 1),
        -1
      );
      const startIndex = inlineRange.index - annotatedText.length - 1;

      undoManager.stopCapturing();

      inlineEditor.formatText(
        {
          index: startIndex,
          length: annotatedText.length,
        },
        {
          italic: true,
        }
      );

      inlineEditor.deleteText({
        index: inlineRange.index - 2,
        length: 2,
      });
      inlineEditor.deleteText({
        index: startIndex,
        length: 1,
      });
      inlineEditor.setInlineRange({
        index: startIndex + annotatedText.length - 2,
        length: 0,
      });
    },
  });

export const StrikethroughExtension =
  InlineMarkdownExtension<NotesGraphTextAttributes>({
    name: 'strikethrough',
    pattern: /.*~{2}([^\s][^~]*[^\s])~{2}\s$|.*~{2}([^\s~])~{2}\s$/,
    action: ({
      inlineEditor,
      prefixText,
      inlineRange,
      pattern,
      undoManager,
    }) => {
      const match = prefixText.match(pattern);
      if (!match) return;

      const targetText = match[1] ?? match[2];
      const annotatedText = match[0].slice(
        -targetText.length - (2 * 2 + 1),
        -1
      );
      const startIndex = inlineRange.index - annotatedText.length - 1;

      undoManager.stopCapturing();

      inlineEditor.formatText(
        {
          index: startIndex,
          length: annotatedText.length,
        },
        {
          strike: true,
        }
      );

      inlineEditor.deleteText({
        index: inlineRange.index - 3,
        length: 3,
      });
      inlineEditor.deleteText({
        index: startIndex,
        length: 2,
      });

      inlineEditor.setInlineRange({
        index: startIndex + annotatedText.length - 4,
        length: 0,
      });
    },
  });

export const UnderthroughExtension =
  InlineMarkdownExtension<NotesGraphTextAttributes>({
    name: 'underthrough',
    pattern: /.*~{1}([^\s][^~]*[^\s~])~{1}\s$|.*~{1}([^\s~])~{1}\s$/,
    action: ({
      inlineEditor,
      prefixText,
      inlineRange,
      pattern,
      undoManager,
    }) => {
      const match = prefixText.match(pattern);
      if (!match) return;

      const targetText = match[1] ?? match[2];
      const annotatedText = match[0].slice(
        -(targetText.length + 1 * 2 + 1),
        -1
      );
      const startIndex = inlineRange.index - annotatedText.length - 1;

      undoManager.stopCapturing();

      inlineEditor.formatText(
        {
          index: startIndex,
          length: annotatedText.length,
        },
        {
          underline: true,
        }
      );

      inlineEditor.deleteText({
        index: inlineRange.index - 2,
        length: 2,
      });
      inlineEditor.deleteText({
        index: startIndex,
        length: 1,
      });

      inlineEditor.setInlineRange({
        index: startIndex + annotatedText.length - 2,
        length: 0,
      });
    },
  });

export const CodeExtension = InlineMarkdownExtension<NotesGraphTextAttributes>({
  name: 'code',
  pattern: /.*`([^\s][^`]*[^\s])`\s$|.*`([^\s`])`\s$/,
  action: ({ inlineEditor, prefixText, inlineRange, pattern, undoManager }) => {
    const match = prefixText.match(pattern);
    if (!match) return;

    const targetText = match[1] ?? match[2];
    const annotatedText = match[0].slice(-(targetText.length + 1 * 2 + 1), -1);
    const startIndex = inlineRange.index - annotatedText.length - 1;

    undoManager.stopCapturing();

    inlineEditor.formatText(
      {
        index: startIndex,
        length: annotatedText.length,
      },
      {
        code: true,
      }
    );

    inlineEditor.deleteText({
      index: inlineRange.index - 2,
      length: 2,
    });
    inlineEditor.deleteText({
      index: startIndex,
      length: 1,
    });

    inlineEditor.setInlineRange({
      index: startIndex + annotatedText.length - 2,
      length: 0,
    });
  },
});

// Org status keywords that map to a real status. Only these convert (not
// arbitrary all-caps words like "API"), keeping in sync with orgStatusLabel.
const ORG_STATUS_KEYWORDS = ['TODO', 'DONE', 'DOING', 'WIP', 'STRT'] as const;

/**
 * Typing a recognized org status keyword as the *sole prefix* of a line — the
 * keyword followed by a space, with nothing before it — turns it into a status
 * chip (e.g. "TODO " -> a Todo chip). The keyword + its trailing space are
 * replaced by a single whitespace character carrying the `orgStatus`
 * attribute: the canonical one-character chip carrier the rest of the
 * org-status machinery uses (a multi-char embed would be split into N chips
 * and break the caret). Only fires at the very start of the block, so
 * "buy a TODO list" is left alone.
 */
export const OrgStatusKeywordMarkdown =
  InlineMarkdownExtension<NotesGraphTextAttributes>({
    name: 'org-status-keyword',
    pattern: new RegExp(`^(${ORG_STATUS_KEYWORDS.join('|')})\\s$`),
    action: ({ inlineEditor, prefixText, inlineRange, pattern, undoManager }) => {
      const match = prefixText.match(pattern);
      if (!match) return;
      const keyword = match[1];
      // The keyword must be the whole prefix: caret right after the space.
      if (inlineRange.index !== keyword.length + 1) return;

      undoManager.stopCapturing();
      // Delete just the keyword, keep the space the user typed, then annotate
      // that single space so it renders as the chip. Caret follows the delete
      // and sits right after the chip so typing continues normally.
      inlineEditor.deleteText({ index: 0, length: keyword.length });
      inlineEditor.formatText({ index: 0, length: 1 }, { orgStatus: keyword });
      inlineEditor.setInlineRange({ index: 1, length: 0 });
    },
  });

export const MarkdownExtensions: ExtensionType[] = [
  BoldItalicMarkdown,
  BoldMarkdown,
  ItalicExtension,
  StrikethroughExtension,
  UnderthroughExtension,
  CodeExtension,
  OrgStatusKeywordMarkdown,
  LatexExtension,
];
