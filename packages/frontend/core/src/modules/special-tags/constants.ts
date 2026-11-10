import { cssVar } from '@toeverything/theme';

/**
 * Kinds of note the app makes for you: journal pages, agent conversation
 * transcripts and calendar event notes. Each gets an ordinary workspace tag
 * with a fixed id, so features can tell them apart from your own notes and
 * search can filter on them, and renaming the tag changes nothing.
 */
export type SpecialKind = 'journal' | 'ai-conversation' | 'calendar-event';

export interface SpecialTagDef {
  id: string;
  /** The tag's name when the app creates it. */
  value: string;
  color: string;
  /** The search token: `is:<search>` keeps these notes, `-is:` drops them. */
  search: string;
}

export const SPECIAL_TAGS: Record<SpecialKind, SpecialTagDef> = {
  journal: {
    id: 'ng-special-journal',
    value: 'Journal',
    color: cssVar('tagBlue'),
    search: 'journal',
  },
  'ai-conversation': {
    id: 'ng-special-ai-conversation',
    value: 'AI conversation',
    color: cssVar('tagPurple'),
    search: 'conversation',
  },
  'calendar-event': {
    id: 'ng-special-calendar-event',
    value: 'Calendar event',
    color: cssVar('tagOrange'),
    search: 'calendar',
  },
};

export const SPECIAL_KINDS = Object.keys(SPECIAL_TAGS) as SpecialKind[];

export const SPECIAL_TAG_IDS = new Set(
  SPECIAL_KINDS.map(k => SPECIAL_TAGS[k].id)
);

/** The kind an `is:` search value names, if any. */
export function specialKindForSearch(value: string): SpecialKind | undefined {
  const needle = value.toLowerCase();
  return SPECIAL_KINDS.find(kind => SPECIAL_TAGS[kind].search === needle);
}

/**
 * `wf` files each agent conversation in the `ai / conversations` folder and
 * also links it under a note titled "conversations" (the note tree is built
 * from links). Those hub notes are not conversations themselves.
 */
export const CONVERSATIONS_HUB_TITLE = 'conversations';
