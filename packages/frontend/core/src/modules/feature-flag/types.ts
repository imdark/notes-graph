import type { BlockSuiteFlags } from '@blocksuite/notesgraph/shared/services';

type FeedbackType = 'discord' | 'email' | 'github';

export type FlagInfo = {
  /**
   * The commit that added the flag, checked against what prod was deployed
   * from. A new flag starts with `commit: ''`; once it is committed,
   * `node scripts/stamp-feature-flags.mjs` fills it in.
   */
  commit: string;
  displayName: string;
  description?: string;
  configurable?: boolean;
  defaultState?: boolean; // default to open and not controlled by user
  /**
   * hide in the feature flag settings, but still can be controlled by the code
   */
  hide?: boolean;
  feedbackType?: FeedbackType;
  feedbackLink?: string;
} & (
  | {
      category: 'notesgraph';
    }
  | {
      category: 'blocksuite';
      bsFlag: keyof BlockSuiteFlags;
    }
);
