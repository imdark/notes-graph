import { type ComponentType, createContext, type ReactNode } from 'react';

import { NavigationPanelDocNode } from '../../nodes/doc';
import type { NodeOperation } from '../../tree/types';

/** The props the notes tree passes to a doc row. */
export interface NotesTreeDocNodeProps {
  docId: string;
  parentPath: string[];
  isLinked?: boolean;
  reorderable?: boolean;
  /** Render linked docs as nested children regardless of the sidebar setting. */
  alwaysShowChildren?: boolean;
  /** Collapsed state to use when nothing is stored yet. */
  defaultCollapsed?: boolean;
  /** Extra nodes rendered below the doc's children (Journal/Inbox under Home). */
  trailingChildren?: ReactNode;
  operations?: NodeOperation[];
}

/**
 * Which component renders a doc row in the notes tree. The desktop row is
 * the default; the mobile Home provides its own, lighter row (no drag and
 * drop, tooltips or hover menus), which matters when a workspace mounts a
 * few hundred rows on a phone.
 */
export const NotesTreeDocNodeContext = createContext<
  ComponentType<NotesTreeDocNodeProps>
>(NavigationPanelDocNode);
