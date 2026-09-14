import type { DocTitle } from '@blocksuite/notesgraph/fragments/doc-title';
import type { DocMode } from '@blocksuite/notesgraph/model';
import type { Store } from '@blocksuite/notesgraph/store';
import type {
  EdgelessEditor,
  PageEditor,
} from '@notesgraph/core/blocksuite/editors';
import type { DefaultOpenProperty } from '@notesgraph/core/components/properties';
import type {
  ComponentType,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  ReactNode,
  Ref,
  RefAttributes,
} from 'react';

/** Props every doc-mode editor component accepts (superset across modes). */
export interface DocModeEditorProps {
  page: Store;
  shared?: boolean;
  /** shared page whose public link grants read + comment */
  sharedCommentable?: boolean;
  readonly?: boolean;
  defaultOpenProperty?: DefaultOpenProperty;
  onClickBlank?: () => void;
  titleRef?: Ref<DocTitle>;
}

export type DocModeEditorComponent = ForwardRefExoticComponent<
  PropsWithoutRef<DocModeEditorProps> &
    RefAttributes<PageEditor | EdgelessEditor>
>;

/**
 * Describes a doc editing mode. "page" is built in; additional modes (notably
 * "edgeless") are contributed by plugins via the `docModes` capability so the
 * core app renders mode toggles, create entries, the primary-mode property, the
 * new-doc-default setting, and the editor itself by iterating registered modes
 * — with no hardcoded knowledge of any specific mode.
 */
export interface DocModeDescriptor {
  /** Doc mode id, e.g. 'page' or 'edgeless'. */
  id: DocMode;
  /** i18n key for the mode's name (resolved by consumers via t.t / I18n.t). */
  labelKey: string;
  /** React icon used by create menus and the doc primary-mode property. */
  icon: ComponentType;
  /** Custom toggle label (e.g. an animated switch item); falls back to icon. */
  toggleItem?: ReactNode;
  /** Lit icon factory for the `@`-menu "create" item. */
  creationIcon?: () => unknown;
  /** Whether this mode is offered when creating docs / as a new-doc default. */
  creatable?: boolean;
  /** Sort order across mode surfaces (page = 0). */
  order?: number;
  /** Editor component for this mode; undefined uses the default page editor. */
  editor?: DocModeEditorComponent;
  /** BlockSuite view-extension providers contributed while this mode exists. */
  viewExtensions?: unknown[];
}
