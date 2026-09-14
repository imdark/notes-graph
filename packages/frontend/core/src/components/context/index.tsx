import {
  ConfirmModalProvider,
  PromptModalProvider,
} from '@notesgraph/component';
import { ProviderComposer } from '@notesgraph/component/provider-composer';
import { ThemeProvider } from '@notesgraph/core/components/theme-provider';
import type { createStore } from 'jotai';
import { Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';

import { useImageAntialiasing } from '../hooks/use-image-antialiasing';

export type NotesGraphContextProps = PropsWithChildren<{
  store?: ReturnType<typeof createStore>;
}>;

export function NotesGraphContext(props: NotesGraphContextProps) {
  useImageAntialiasing();
  return (
    <ProviderComposer
      contexts={useMemo(
        () =>
          [
            <Provider key="JotaiProvider" store={props.store} />,
            <ThemeProvider key="ThemeProvider" />,
            <ConfirmModalProvider key="ConfirmModalProvider" />,
            <PromptModalProvider key="PromptModalProvider" />,
          ].filter(Boolean),
        [props.store]
      )}
    >
      {props.children}
    </ProviderComposer>
  );
}
