import { CommentInlineSpecExtension } from '@blocksuite/notesgraph-inline-comment';
import { FootNoteInlineSpecExtension } from '@blocksuite/notesgraph-inline-footnote';
import { LatexInlineSpecExtension } from '@blocksuite/notesgraph-inline-latex';
import { LinkInlineSpecExtension } from '@blocksuite/notesgraph-inline-link';
import { MentionInlineSpecExtension } from '@blocksuite/notesgraph-inline-mention';
import { ReferenceInlineSpecExtension } from '@blocksuite/notesgraph-inline-reference';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import { InlineManagerExtension } from '@blocksuite/std/inline';

import {
  BackgroundInlineSpecExtension,
  BoldInlineSpecExtension,
  CodeInlineSpecExtension,
  ColorInlineSpecExtension,
  ItalicInlineSpecExtension,
  OrgMentionInlineSpecExtension,
  OrgStatusInlineSpecExtension,
  OrgTagInlineSpecExtension,
  OrgTimestampInlineSpecExtension,
  StrikeInlineSpecExtension,
  UnderlineInlineSpecExtension,
} from './inline-spec';

export const DefaultInlineManagerExtension =
  InlineManagerExtension<NotesGraphTextAttributes>({
    id: 'DefaultInlineManager',
    specs: [
      BoldInlineSpecExtension.identifier,
      ItalicInlineSpecExtension.identifier,
      UnderlineInlineSpecExtension.identifier,
      StrikeInlineSpecExtension.identifier,
      CodeInlineSpecExtension.identifier,
      BackgroundInlineSpecExtension.identifier,
      ColorInlineSpecExtension.identifier,
      LatexInlineSpecExtension.identifier,
      ReferenceInlineSpecExtension.identifier,
      LinkInlineSpecExtension.identifier,
      FootNoteInlineSpecExtension.identifier,
      MentionInlineSpecExtension.identifier,
      CommentInlineSpecExtension.identifier,
      OrgStatusInlineSpecExtension.identifier,
      OrgTimestampInlineSpecExtension.identifier,
      OrgTagInlineSpecExtension.identifier,
      OrgMentionInlineSpecExtension.identifier,
    ],
  });
