import {
  CheckBoxCheckLinearIcon,
  DateTimeIcon,
  LinkedPageIcon,
  LinkIcon,
  MultiSelectIcon,
  NumberIcon,
  ProgressIcon,
  SingleSelectIcon,
  TextIcon,
} from '@blocksuite/icons/rc';
import type { I18nString } from '@notesgraph/i18n';

import type { DatabaseCellRendererProps } from '../../types';
import { CheckboxCell } from './cells/checkbox';
import { DateCell } from './cells/date';
import { LinkCell } from './cells/link';
import { NumberCell } from './cells/number';
import { ProgressCell } from './cells/progress';
import { RelationCell } from './cells/relation';
import { RichTextCell } from './cells/rich-text';
import { MultiSelectCell, SelectCell } from './cells/select';

export const DatabaseRendererTypes = {
  'rich-text': {
    Icon: TextIcon,
    Renderer: RichTextCell,
    name: 'com.notesgraph.page-properties.property.text',
  },
  checkbox: {
    Icon: CheckBoxCheckLinearIcon,
    Renderer: CheckboxCell,
    name: 'com.notesgraph.page-properties.property.checkbox',
  },
  date: {
    Icon: DateTimeIcon,
    Renderer: DateCell,
    name: 'com.notesgraph.page-properties.property.date',
  },
  number: {
    Icon: NumberIcon,
    Renderer: NumberCell,
    name: 'com.notesgraph.page-properties.property.number',
  },
  link: {
    Icon: LinkIcon,
    Renderer: LinkCell,
    name: 'com.notesgraph.page-properties.property.link',
  },
  progress: {
    Icon: ProgressIcon,
    Renderer: ProgressCell,
    name: 'com.notesgraph.page-properties.property.progress',
  },
  select: {
    Icon: SingleSelectIcon,
    Renderer: SelectCell,
    name: 'com.notesgraph.page-properties.property.select',
  },
  'multi-select': {
    Icon: MultiSelectIcon,
    Renderer: MultiSelectCell,
    name: 'com.notesgraph.page-properties.property.multi-select',
  },
  relation: {
    Icon: LinkedPageIcon,
    Renderer: RelationCell,
    name: 'Relation',
  },
} as Record<
  string,
  {
    Icon: React.FC<React.SVGProps<SVGSVGElement>>;
    Renderer: React.FC<DatabaseCellRendererProps>;
    name: I18nString;
  }
>;

export const isSupportedDatabaseRendererType = (type?: string): boolean => {
  return type ? type in DatabaseRendererTypes : false;
};
