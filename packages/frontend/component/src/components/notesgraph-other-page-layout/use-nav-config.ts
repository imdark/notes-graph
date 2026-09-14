import { useI18n } from '@notesgraph/i18n';
import { useMemo } from 'react';

export const useNavConfig = () => {
  const t = useI18n();
  return useMemo(
    () => [
      {
        title: t['com.notesgraph.other-page.nav.official-website'](),
        path: 'https://notesgraph.com',
      },
      {
        title: t['com.notesgraph.other-page.nav.blog'](),
        path: 'https://notesgraph.com/blog',
      },
      {
        title: t['com.notesgraph.other-page.nav.contact-us'](),
        path: 'https://notesgraph.com/about-us',
      },
    ],
    [t]
  );
};
