import { AppThemeService } from '@notesgraph/core/modules/theme';
import { useService } from '@notesgraph/infra';
import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';

const themes = ['dark', 'light'];

function ThemeObserver() {
  const { resolvedTheme } = useTheme();
  const service = useService(AppThemeService);

  useEffect(() => {
    service.appTheme.theme$.next(resolvedTheme);
  }, [resolvedTheme, service.appTheme.theme$]);

  return null;
}

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  return (
    <NextThemeProvider
      themes={themes}
      enableSystem={true}
      defaultTheme="dark"
    >
      {children}
      <ThemeObserver />
    </NextThemeProvider>
  );
};
