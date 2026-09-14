import type { FootNote, ReferenceInfo } from '@blocksuite/notesgraph-model';
import type { InlineEditor } from '@blocksuite/std/inline';
import type { BlockModel } from '@blocksuite/store';
export * from './uni-component';

export type NoteChildrenFlavour =
  | 'notesgraph:paragraph'
  | 'notesgraph:list'
  | 'notesgraph:code'
  | 'notesgraph:divider'
  | 'notesgraph:database'
  | 'notesgraph:data-view'
  | 'notesgraph:image'
  | 'notesgraph:bookmark'
  | 'notesgraph:attachment'
  | 'notesgraph:surface-ref';

export interface Viewport {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export type ExtendedModel = BlockModel & Record<string, any>;

export type IndentContext = {
  blockId: string;
  inlineIndex: number;
  flavour: string;
  type: 'indent' | 'dedent';
};

export type NotesGraphTextStyleAttributes = {
  bold?: true | null;
  italic?: true | null;
  underline?: true | null;
  strike?: true | null;
  code?: true | null;
  color?: string | null;
  background?: string | null;
};

export type NotesGraphTextAttributes = NotesGraphTextStyleAttributes & {
  link?: string | null;
  reference?:
    | ({
        type: 'Subpage' | 'LinkedPage';
      } & ReferenceInfo)
    | null;
  latex?: string | null;
  /**
   * An org-mode status annotation (`[ ]`, `[-]`, `[X]`, or an uppercase
   * TODO keyword) carried on a single embedded character, rendered as a
   * status chip with a dropdown. Like `latex`, the attribute value holds
   * the plain-text form; adapters serialize it back to org syntax.
   */
  orgStatus?: string | null;
  /**
   * An org-mode planning/log timestamp annotation (`SCHEDULED: <…>`,
   * `DEADLINE: <…>`, `CLOSED: […]`, `STARTED: […]`, `CREATED: […]`)
   * carried on a single embedded character, rendered as a date badge at
   * the end of the line. The attribute value holds the plain-text form.
   */
  orgTimestamp?: string | null;
  /**
   * An inline `#tag` / `#key:value` token on a task line, styled as a tag
   * chip. Unlike orgStatus/orgTimestamp the token's REAL text stays in the
   * document — this attribute only decorates it, so markdown round-trips
   * and hand edits are unaffected. Value = token without the `#`.
   */
  orgTag?: string | null;
  /**
   * An inline `@agent` claim on a task line (agents aren't workspace
   * members, so the member `mention` attribute doesn't apply). Decoration
   * only, like orgTag. Value = name without the `@`.
   */
  orgMention?: string | null;
  footnote?: FootNote | null;
  mention?: {
    member: string;
    notification?: string;
  } | null;
  [key: `comment-${string}`]: boolean | null;
};

export type NotesGraphInlineEditor = InlineEditor<NotesGraphTextAttributes>;

export type SelectedRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  borderWidth: number;
  borderStyle: string;
  rotate: number;
};
