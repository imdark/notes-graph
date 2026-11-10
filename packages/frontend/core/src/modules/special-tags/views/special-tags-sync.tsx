import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import { SpecialTagsService } from '../services/special-tags';

/**
 * Puts the special tags on journal pages, conversations and calendar notes
 * while the workspace is open. Renders nothing; mount once per workspace.
 */
export const SpecialTagsSync = () => {
  const specialTags = useService(SpecialTagsService);
  useEffect(() => specialTags.start(), [specialTags]);
  return null;
};
