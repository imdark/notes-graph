import type { DocMode } from '@blocksuite/notesgraph/model';
import {
  type CommandCategory,
  type NotesGraphCommand,
  NotesGraphCommandRegistry,
  PreconditionStrategy,
} from '@notesgraph/core/commands';
import { Entity, LiveData } from '@notesgraph/infra';
import Fuse from 'fuse.js';

import type { GlobalContextService } from '../../global-context';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchGroup } from '../types/group';
import type { QuickSearchItem } from '../types/item';
import { highlighter } from '../utils/highlighter';

const categories = {
  'notesgraph:recent': {
    id: 'command:notesgraph:recent',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.recent',
    },
    score: 10,
  },
  'notesgraph:navigation': {
    id: 'command:notesgraph:navigation',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.navigation',
    },
    score: 10,
  },
  'notesgraph:creation': {
    id: 'command:notesgraph:creation',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.creation',
    },
    score: 10,
  },
  'notesgraph:general': {
    id: 'command:notesgraph:general',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.general',
    },
    score: 10,
  },
  'notesgraph:layout': {
    id: 'command:notesgraph:layout',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.layout',
    },
    score: 10,
  },
  'notesgraph:pages': {
    id: 'command:notesgraph:pages',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.pages',
    },
    score: 10,
  },
  'notesgraph:edgeless': {
    id: 'command:notesgraph:edgeless',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.edgeless',
    },
    score: 10,
  },
  'notesgraph:collections': {
    id: 'command:notesgraph:collections',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.collections',
    },
    score: 10,
  },
  'notesgraph:settings': {
    id: 'command:notesgraph:settings',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.settings',
    },
    score: 10,
  },
  'notesgraph:updates': {
    id: 'command:notesgraph:updates',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.updates',
    },
    score: 10,
  },
  'notesgraph:help': {
    id: 'command:notesgraph:help',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.notesgraph.help',
    },
    score: 10,
  },
  'editor:edgeless': {
    id: 'command:editor:edgeless',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.editor.edgeless',
    },
    score: 10,
  },
  'editor:insert-object': {
    id: 'command:editor:insert-object',
    label: {
      i18nKey: 'com.notesgraph.cmdk.notesgraph.category.editor.insert-object',
    },
    score: 10,
  },
  'editor:page': {
    id: 'command:editor:page',
    label: { i18nKey: 'com.notesgraph.cmdk.notesgraph.category.editor.page' },
    score: 10,
  },
  // Actions on the current text/block selection — ranked above every
  // other group so the palette doubles as the selection context menu.
  'editor:selection': {
    id: 'command:editor:selection',
    label: 'Selection',
    score: 20,
  },
  'notesgraph:results': {
    id: 'command:notesgraph:results',
    label: { i18nKey: 'com.notesgraph.cmdk.notesgraph.category.results' },
    score: 10,
  },
} satisfies Required<{
  [key in CommandCategory]: QuickSearchGroup & { id: `command:${key}` };
}>;

function filterCommandByContext(
  command: NotesGraphCommand,
  context: {
    docMode: DocMode | undefined;
  }
) {
  if (command.preconditionStrategy === PreconditionStrategy.Always) {
    return true;
  }
  if (command.preconditionStrategy === PreconditionStrategy.InEdgeless) {
    return context.docMode === 'edgeless';
  }
  if (command.preconditionStrategy === PreconditionStrategy.InPaper) {
    return context.docMode === 'page';
  }
  if (command.preconditionStrategy === PreconditionStrategy.InPaperOrEdgeless) {
    return !!context.docMode;
  }
  if (command.preconditionStrategy === PreconditionStrategy.Never) {
    return false;
  }
  if (typeof command.preconditionStrategy === 'function') {
    return command.preconditionStrategy();
  }
  return true;
}

function getAllCommand(context: { docMode: DocMode | undefined }) {
  const commands = NotesGraphCommandRegistry.getAll();
  return commands.filter(command => {
    return filterCommandByContext(command, context);
  });
}

export class CommandsQuickSearchSession
  extends Entity
  implements QuickSearchSession<'commands', NotesGraphCommand>
{
  constructor(private readonly contextService: GlobalContextService) {
    super();
  }

  query$ = new LiveData('');

  items$ = LiveData.computed(get => {
    const query = get(this.query$);
    const docMode =
      get(this.contextService.globalContext.docMode.$) ?? undefined;
    const commands = getAllCommand({ docMode });

    const fuse = new Fuse(commands, {
      keys: [{ name: 'label.title', weight: 2 }, 'label.subTitle'],
      includeMatches: true,
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.0,
    });

    const result = query
      ? fuse.search(query)
      : commands.map(item => ({ item, matches: [], score: 0 }));

    return result.map<QuickSearchItem<'commands', NotesGraphCommand>>(
      ({ item, matches, score = 1 }) => {
        const normalizedRange = ([start, end]: [number, number]) =>
          [
            start,
            end + 1 /* in fuse, the `end` is different from the `substring` */,
          ] as [number, number];
        const titleMatches = matches
          ?.filter(match => match.key === 'label.title')
          .flatMap(match => match.indices.map(normalizedRange));
        const subTitleMatches = matches
          ?.filter(match => match.key === 'label.subTitle')
          .flatMap(match => match.indices.map(normalizedRange));

        return {
          id: 'command:' + item.id,
          source: 'commands',
          label: {
            title:
              highlighter(
                item.label.title,
                '<b>',
                '</b>',
                titleMatches ?? []
              ) ?? item.label.title,
            subTitle: item.label.subTitle
              ? (highlighter(
                  item.label.subTitle,
                  '<b>',
                  '</b>',
                  subTitleMatches ?? []
                ) ?? item.label.subTitle)
              : undefined,
          },
          group: categories[item.category],
          score:
            1 -
            score /* in fuse, the smaller the score, the better the match, so we need to reverse it */,
          icon: item.icon,
          keyBinding: item.keyBinding?.binding,
          payload: item,
        };
      }
    );
  });

  query(query: string) {
    this.query$.next(query);
  }
}
