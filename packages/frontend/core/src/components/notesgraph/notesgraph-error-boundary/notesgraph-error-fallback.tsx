import { useI18n } from '@notesgraph/i18n';
import { getCurrentStore } from '@notesgraph/infra';
import clsx from 'clsx';
import { Provider } from 'jotai/react';
import type { FC } from 'react';
import { useCallback, useMemo } from 'react';
import { useRouteError } from 'react-router-dom';

import { ErrorDetail } from './error-basic/error-detail';
import type { FallbackProps } from './error-basic/fallback-creator';
import { ERROR_REFLECT_KEY } from './error-basic/fallback-creator';
import { DumpInfo } from './error-basic/info-logger';
import { AnyErrorFallback } from './error-fallbacks/any-error-fallback';
import { NoPageRootFallback } from './error-fallbacks/no-page-root-fallback';
import { PageNotFoundDetail } from './error-fallbacks/page-not-found-fallback';
import * as styles from './notesgraph-error-fallback.css';

/**
 * Register all fallback components here.
 * If have new one just add it to the set.
 */
const fallbacks = new Set([PageNotFoundDetail, NoPageRootFallback]);

function getErrorFallbackComponent(error: any): FC<FallbackProps> {
  for (const Component of fallbacks) {
    const ErrorConstructor = Reflect.get(Component, ERROR_REFLECT_KEY);
    if (ErrorConstructor && error instanceof ErrorConstructor) {
      return Component as FC<FallbackProps>;
    }
  }
  return AnyErrorFallback;
}

export interface NotesGraphErrorFallbackProps extends FallbackProps {
  height?: number | string;
  className?: string;
}

export const NotesGraphErrorFallback: FC<
  NotesGraphErrorFallbackProps
> = props => {
  const { error, resetError, height } = props;
  const Component = useMemo(() => getErrorFallbackComponent(error), [error]);

  return (
    <div className={clsx(styles.viewport, props.className)} style={{ height }}>
      <Component error={error} resetError={resetError} />
      <Provider key="JotaiProvider" store={getCurrentStore()}>
        <DumpInfo error={error} />
      </Provider>
    </div>
  );
};

export const NotesGraphErrorComponent = () => {
  const error = useRouteError() as Error;

  const t = useI18n();

  const reloadPage = useCallback(() => {
    document.location.reload();
  }, []);

  return (
    <ErrorDetail
      title={t['com.notesgraph.error.unexpected-error.title']()}
      resetError={reloadPage}
      buttonText={t['com.notesgraph.error.reload']()}
      description={
        'message' in (error as Error) ? (error as Error).message : `${error}`
      }
      error={error as Error}
    />
  );
};
