import { CategoryDivider } from '@notesgraph/core/modules/app-sidebar/views';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { useLiveData, useService } from '@notesgraph/infra';
import * as Collapsible from '@radix-ui/react-collapsible';
import clsx from 'clsx';
import {
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useCallback,
} from 'react';

import { content, header, root } from './collapsible-section.css';

interface CollapsibleSectionProps extends PropsWithChildren {
  path: string[];
  title: string;
  actions?: ReactNode;
  alwaysShowActions?: boolean;

  className?: string;
  testId?: string;

  headerRef?: RefObject<HTMLDivElement>;
  headerTestId?: string;
  headerClassName?: string;

  contentClassName?: string;
  contentStyle?: CSSProperties;
}

export const CollapsibleSection = ({
  path,
  title,
  actions,
  alwaysShowActions,
  children,

  className,
  testId,

  headerRef,
  headerTestId,
  headerClassName,

  contentClassName,
  contentStyle,
}: CollapsibleSectionProps) => {
  const navigationPanelService = useService(NavigationPanelService);

  const collapsed = useLiveData(navigationPanelService.collapsed$(path));

  const setCollapsed = useCallback(
    (v: boolean) => {
      navigationPanelService.setCollapsed(path, v);
    },
    [navigationPanelService, path]
  );

  return (
    <Collapsible.Root
      data-collapsed={collapsed}
      className={clsx(root, className)}
      open={!collapsed}
      data-testid={testId}
    >
      <CategoryDivider
        data-testid={headerTestId}
        label={title}
        setCollapsed={setCollapsed}
        collapsed={collapsed}
        ref={headerRef}
        className={clsx(header, headerClassName)}
        alwaysShowActions={alwaysShowActions}
      >
        {actions}
      </CategoryDivider>
      <Collapsible.Content
        data-testid="collapsible-section-content"
        className={clsx(content, contentClassName)}
        style={contentStyle}
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
};
