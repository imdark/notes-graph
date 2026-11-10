import { type TagLike, TagsInlineEditor } from '@notesgraph/core/components/tags';
import { TagService } from '@notesgraph/core/modules/tag';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo, useRef, useState } from 'react';

import * as styles from './discover.css';
import {
  loadTopicPrefs,
  saveTopicPrefs,
  topicOptions,
  type TopicPrefs,
} from './feed';

const keyOf = (topic: string) => topic.trim().toLowerCase();

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * The Discover topics as a multi-select keyword dropdown: pick from the
 * suggestions or type a new topic. A topic's id is its lowercase name.
 */
export const TopicsPicker = ({
  selected,
  suggestions,
  onChange,
}: {
  selected: string[];
  suggestions: string[];
  onChange: (topics: string[]) => void;
}) => {
  const t = useI18n();
  const tagService = useService(TagService);
  const [prefs, setPrefs] = useState<TopicPrefs>(() => loadTopicPrefs());

  const updatePrefs = useCallback((update: (old: TopicPrefs) => TopicPrefs) => {
    setPrefs(old => {
      const next = update(old);
      saveTopicPrefs(next);
      return next;
    });
  }, []);

  const tagColors = useMemo(
    () =>
      tagService.tagColors.map(([name, value]) => ({ id: name, value, name })),
    [tagService.tagColors]
  );

  const tags: TagLike[] = useMemo(
    () =>
      topicOptions(selected, prefs, suggestions).map(name => {
        const id = keyOf(name);
        return {
          id,
          name,
          color:
            prefs.colors[id] ?? tagColors[hash(id) % tagColors.length].value,
        };
      }),
    [selected, prefs, suggestions, tagColors]
  );

  // A topic created in the editor is selected before the next render puts it
  // in `tags`, so its name is looked up here as well.
  const created = useRef(new Map<string, string>());
  const nameOf = useCallback(
    (id: string) =>
      tags.find(tag => tag.id === id)?.name ?? created.current.get(id),
    [tags]
  );

  const selectedIds = useMemo(() => selected.map(keyOf), [selected]);

  const onSelectTag = useCallback(
    (id: string) => {
      const name = nameOf(id);
      if (name && !selectedIds.includes(id)) onChange([...selected, name]);
    },
    [nameOf, onChange, selected, selectedIds]
  );

  const onDeselectTag = useCallback(
    (id: string) => onChange(selected.filter(name => keyOf(name) !== id)),
    [onChange, selected]
  );

  const onCreateTag = useCallback(
    (name: string, color: string) => {
      const id = keyOf(name);
      created.current.set(id, name);
      updatePrefs(old => ({
        known: [...old.known, name],
        hidden: old.hidden.filter(h => h !== id),
        colors: { ...old.colors, [id]: color },
      }));
      return { id, name, color };
    },
    [updatePrefs]
  );

  const onDeleteTag = useCallback(
    (id: string) => {
      updatePrefs(old => {
        const { [id]: _removed, ...colors } = old.colors;
        return {
          known: old.known.filter(name => keyOf(name) !== id),
          hidden: [...old.hidden.filter(h => h !== id), id],
          colors,
        };
      });
      onDeselectTag(id);
    },
    [onDeselectTag, updatePrefs]
  );

  const onTagChange = useCallback(
    (id: string, property: keyof TagLike, value: string) => {
      if (property === 'color') {
        updatePrefs(old => ({
          ...old,
          colors: { ...old.colors, [id]: value },
        }));
        return;
      }
      if (property !== 'name') return;
      const name = value.trim();
      const newId = keyOf(name);
      if (!name || newId === id) return;
      updatePrefs(old => {
        const { [id]: color, ...colors } = old.colors;
        return {
          known: [
            ...old.known.filter(k => keyOf(k) !== id && keyOf(k) !== newId),
            name,
          ],
          hidden: [...old.hidden.filter(h => h !== id && h !== newId), id],
          colors: color ? { ...colors, [newId]: color } : colors,
        };
      });
      if (selectedIds.includes(id)) {
        onChange(
          selected
            .filter(s => keyOf(s) !== newId)
            .map(s => (keyOf(s) === id ? name : s))
        );
      }
    },
    [onChange, selected, selectedIds, updatePrefs]
  );

  return (
    <TagsInlineEditor
      tagMode="inline-tag"
      className={styles.topicsPicker}
      placeholder={t['com.notesgraph.discover.topics.placeholder']()}
      title={t['com.notesgraph.discover.topics.placeholder']()}
      tags={tags}
      selectedTags={selectedIds}
      onSelectTag={onSelectTag}
      onDeselectTag={onDeselectTag}
      onCreateTag={onCreateTag}
      onDeleteTag={onDeleteTag}
      onTagChange={onTagChange}
      tagColors={tagColors}
    />
  );
};
