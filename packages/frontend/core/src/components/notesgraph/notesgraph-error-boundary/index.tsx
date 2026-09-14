import { ErrorBoundary, type FallbackRender } from '@sentry/react';
import type { FC, PropsWithChildren } from 'react';
import { useCallback } from 'react';

import { NotesGraphErrorFallback } from './notesgraph-error-fallback';

export { type FallbackProps } from './error-basic/fallback-creator';

export interface NotesGraphErrorBoundaryProps extends PropsWithChildren {
  height?: number | string;
  className?: string;
}

/**
 * TODO(@eyhn): Unify with SWRErrorBoundary
 */
export const NotesGraphErrorBoundary: FC<
  NotesGraphErrorBoundaryProps
> = props => {
  const fallbackRender: FallbackRender = useCallback(
    fallbackProps => {
      return (
        <NotesGraphErrorFallback
          {...fallbackProps}
          height={props.height}
          className={props.className}
        />
      );
    },
    [props.height, props.className]
  );

  const onError = useCallback((error: unknown, componentStack?: string) => {
    console.error('Uncaught error:', error, componentStack);
  }, []);

  return (
    <ErrorBoundary fallback={fallbackRender} onError={onError}>
      {props.children}
    </ErrorBoundary>
  );
};
