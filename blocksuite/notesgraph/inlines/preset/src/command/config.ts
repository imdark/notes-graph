import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from '@blocksuite/notesgraph-components/icons';
import { toggleLink } from '@blocksuite/notesgraph-inline-link';
import { type EditorHost, TextSelection } from '@blocksuite/std';
import type { TemplateResult } from 'lit';

import {
  isTextAttributeActive,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
} from './text-style.js';

export interface TextFormatConfig {
  id: string;
  name: string;
  icon: TemplateResult<1>;
  hotkey?: string;
  activeWhen: (host: EditorHost) => boolean;
  action: (host: EditorHost) => void;
  textChecker?: (host: EditorHost) => boolean;
}

export const textFormatConfigs: TextFormatConfig[] = [
  {
    id: 'bold',
    name: 'Bold',
    icon: BoldIcon,
    hotkey: 'Mod-b',
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'bold' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleBold).run();
    },
  },
  {
    id: 'italic',
    name: 'Italic',
    icon: ItalicIcon,
    hotkey: 'Mod-i',
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'italic' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleItalic).run();
    },
  },
  {
    id: 'underline',
    name: 'Underline',
    icon: UnderlineIcon,
    hotkey: 'Mod-u',
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'underline' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleUnderline).run();
    },
  },
  {
    id: 'strike',
    name: 'Strikethrough',
    icon: StrikethroughIcon,
    hotkey: 'Mod-shift-s',
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'strike' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleStrike).run();
    },
  },
  {
    id: 'code',
    name: 'Code',
    icon: CodeIcon,
    hotkey: 'Mod-e',
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'code' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleCode).run();
    },
  },
  {
    id: 'link',
    name: 'Link',
    icon: LinkIcon,
    // No Mod-k hotkey: Cmd/Ctrl+K on a text selection opens the command
    // palette (which offers Link among the selection actions); the
    // toolbar button and Markdown syntax still create links directly.
    activeWhen: host => {
      const [result] = host.std.command
        .chain()
        .pipe(isTextAttributeActive, { key: 'link' })
        .run();
      return result;
    },
    action: host => {
      host.std.command.chain().pipe(toggleLink).run();
    },
    // should check text length
    textChecker: host => {
      const textSelection = host.std.selection.find(TextSelection);
      if (!textSelection || textSelection.isCollapsed()) return false;

      // A selection spanning several blocks can't become one inline link —
      // decline so Cmd/Ctrl+K falls through to the command palette, which
      // treats the covered blocks as its selection context.
      if (textSelection.to) return false;

      return Boolean(textSelection.from.length);
    },
  },
];
