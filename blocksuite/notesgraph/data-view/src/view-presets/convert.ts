import { createViewConvert } from '../core/view/convert.js';
import { calendarViewModel } from './calendar/index.js';
import { ganttViewModel } from './gantt/index.js';
import { kanbanViewModel } from './kanban/index.js';
import { listViewModel } from './list/index.js';
import { tableViewModel } from './table/index.js';

const headerToCalendarCard = (header?: { titleColumn?: string }) => ({
  titleColumnId: header?.titleColumn,
  visiblePropertyIds: [],
});

const calendarCardToHeader = (card?: { titleColumnId?: string }) => ({
  titleColumn: card?.titleColumnId,
});

const headerToGanttCard = (header?: { titleColumn?: string }) => ({
  titleColumnId: header?.titleColumn,
});

const ganttCardToHeader = (card?: { titleColumnId?: string }) => ({
  titleColumn: card?.titleColumnId,
});

export const viewConverts = [
  createViewConvert(tableViewModel, kanbanViewModel, data => ({
    filter: data.filter,
    header: data.header,
  })),
  createViewConvert(kanbanViewModel, tableViewModel, data => ({
    filter: data.filter,
    header: data.header,
    groupBy: data.groupBy,
  })),
  createViewConvert(tableViewModel, calendarViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    card: headerToCalendarCard(data.header),
  })),
  createViewConvert(kanbanViewModel, calendarViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    card: headerToCalendarCard(data.header),
  })),
  createViewConvert(calendarViewModel, tableViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: calendarCardToHeader(data.card),
  })),
  createViewConvert(calendarViewModel, kanbanViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: calendarCardToHeader(data.card),
  })),
  createViewConvert(tableViewModel, ganttViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    card: headerToGanttCard(data.header),
  })),
  createViewConvert(kanbanViewModel, ganttViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    card: headerToGanttCard(data.header),
  })),
  createViewConvert(calendarViewModel, ganttViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    date: data.date,
    card: headerToGanttCard(calendarCardToHeader(data.card)),
  })),
  createViewConvert(ganttViewModel, tableViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: ganttCardToHeader(data.card),
  })),
  createViewConvert(ganttViewModel, kanbanViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: ganttCardToHeader(data.card),
  })),
  createViewConvert(ganttViewModel, calendarViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    date: data.date,
    card: headerToCalendarCard(ganttCardToHeader(data.card)),
  })),
  // List shares table's header shape ({ titleColumn }), so filter/sort/header
  // carry over directly.
  createViewConvert(tableViewModel, listViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: data.header,
  })),
  createViewConvert(listViewModel, tableViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: data.header,
  })),
  createViewConvert(kanbanViewModel, listViewModel, data => ({
    filter: data.filter,
    header: data.header,
  })),
  createViewConvert(listViewModel, kanbanViewModel, data => ({
    filter: data.filter,
    sort: data.sort,
    header: data.header,
  })),
];
