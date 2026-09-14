import type { DatabaseBlockDataSource } from '@blocksuite/notesgraph/blocks/database';
import { Menu, MenuItem, PropertyValue } from '@notesgraph/component';
import { LiveData, useLiveData } from '@notesgraph/infra';
import { type CSSProperties, useCallback, useMemo } from 'react';

import type { DatabaseCellRendererProps } from '../../../types';

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: 180,
  height: 22,
  padding: '0 8px',
  borderRadius: 4,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  background: 'var(--notesgraph-background-secondary-color)',
  color: 'var(--notesgraph-text-primary-color)',
};

const resolveTitle = (
  dataSource: DatabaseBlockDataSource,
  rowId: string
): string => {
  const titleId = dataSource.properties$.value.find(
    id => dataSource.propertyTypeGet(id) === 'title'
  );
  if (!titleId) return 'Untitled';
  const value = dataSource.cellValueGet(rowId, titleId) as
    | { toString(): string }
    | null
    | undefined;
  return (value?.toString() ?? '').trim() || 'Untitled';
};

/**
 * Editable renderer for `relation` columns (Parent / Depends on) in the doc
 * info panel: shows chips of the linked tasks and, on click, a picker of the
 * other rows in the database to toggle.
 */
export const RelationCell = ({
  cell,
  dataSource,
  rowId,
  onChange,
}: DatabaseCellRendererProps) => {
  const value = useLiveData(cell.value$);
  const selectedIds = useMemo(
    () =>
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string')
        : [],
    [value]
  );

  const rowIds$ = useMemo(
    () => LiveData.fromSignal(dataSource.rows$),
    [dataSource]
  );
  const allRowIds = useLiveData(rowIds$);

  const candidates = useMemo(
    () =>
      allRowIds
        .filter(id => id !== rowId)
        .map(id => ({ id, title: resolveTitle(dataSource, id) })),
    [allRowIds, rowId, dataSource]
  );
  const selectedItems = useMemo(
    () => selectedIds.map(id => ({ id, title: resolveTitle(dataSource, id) })),
    [selectedIds, dataSource]
  );

  const toggle = useCallback(
    (id: string) => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter(existing => existing !== id)
        : [...selectedIds, id];
      dataSource.cellValueChange(rowId, cell.property.id, next);
      onChange(next);
    },
    [selectedIds, dataSource, rowId, cell.property.id, onChange]
  );

  const items =
    candidates.length === 0 ? (
      <div
        style={{
          padding: '6px 12px',
          fontSize: 12,
          color: 'var(--notesgraph-text-secondary-color)',
        }}
      >
        No other tasks
      </div>
    ) : (
      candidates.map(candidate => (
        <MenuItem
          key={candidate.id}
          checked={selectedIds.includes(candidate.id)}
          onSelect={event => {
            event.preventDefault();
            toggle(candidate.id);
          }}
        >
          {candidate.title}
        </MenuItem>
      ))
    );

  return (
    <Menu
      items={
        <div style={{ maxHeight: 320, overflowY: 'auto', minWidth: 200 }}>
          {items}
        </div>
      }
    >
      <PropertyValue>
        {selectedItems.length === 0 ? (
          <span style={{ color: 'var(--notesgraph-text-secondary-color)' }}>
            Empty
          </span>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '2px 0',
            }}
          >
            {selectedItems.map(item => (
              <span key={item.id} title={item.title} style={chipStyle}>
                {item.title}
              </span>
            ))}
          </div>
        )}
      </PropertyValue>
    </Menu>
  );
};
