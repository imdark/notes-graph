import { Button, Checkbox, Input, notify } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import { GlobalCacheService } from '@notesgraph/core/modules/storage';
import { TagService } from '@notesgraph/core/modules/tag';
import { VirtualViewsService } from '@notesgraph/core/modules/virtual-views';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { combineLatest, firstValueFrom } from 'rxjs';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../../modules/workbench';
import * as styles from './discover.css';
import {
  type DiscoverItem,
  FEED_MAX_AGE_MS,
  fetchCardImage,
  fetchDiscoverFeed,
  loadCachedFeed,
  loadTopics,
  parseTopicsInput,
  saveCachedFeed,
  saveTopics,
} from './feed';
import {
  deriveInterests,
  INTERESTS_MAX_AGE_MS,
  interestSearchTopics,
  loadInterests,
  loadUseInterests,
  type NotesSnapshot,
  saveInterests,
  saveUseInterests,
  type UserInterests,
} from './interests';
import { interleaveFeed, virtualItemsToFeed } from './records';

/** One read of the titles, tags and edit dates of every note not in the trash. */
async function readNotesSnapshot(
  docsService: DocsService,
  tagService: TagService
): Promise<NotesSnapshot> {
  const [ids, titles, tags, updated] = await firstValueFrom(
    combineLatest([
      docsService.allNonTrashDocIds$(),
      docsService.allDocTitle$(),
      docsService.allDocsTagIds$(),
      docsService.allDocsUpdatedDate$(),
    ])
  );
  const live = new Set(ids);
  const tagsById = new Map(tags.map(d => [d.id, d.tags]));
  const updatedById = new Map(updated.map(d => [d.id, d.updatedDate]));
  const tagNames = new Map(
    tagService.tagList.tagMetas$.value.map(m => [m.id, m.name])
  );
  return {
    tagNames,
    docs: titles
      .filter(d => live.has(d.id))
      .map(d => ({
        id: d.id,
        title: d.title,
        tagIds: tagsById.get(d.id) ?? [],
        updatedDate: updatedById.get(d.id),
      })),
  };
}

function timeAgo(ms?: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const FeedCard = ({
  item,
  onOpen,
  onSave,
}: {
  item: DiscoverItem;
  onOpen: (item: DiscoverItem) => void;
  onSave: (item: DiscoverItem) => void;
}) => {
  const t = useI18n();
  const globalCache = useService(GlobalCacheService).globalCache;
  const [image, setImage] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  // Resolve the preview image lazily, just before the card scrolls into view,
  // so every row gets an image (not only the first 8) while the fetches
  // "prepopulate in the background" ahead of the user instead of all at once.
  useEffect(() => {
    // A record brings its own image or none: its title is an email subject or
    // a Slack message, which must not go to the news-image web search.
    if (item.origin === 'record') {
      setImage(item.thumbnail ?? null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      fetchCardImage(item, globalCache)
        .then(img => {
          if (!cancelled) setImage(img);
        })
        .catch(() => {});
    };
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          start();
          observer.disconnect();
        }
      },
      { rootMargin: '800px' }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item, globalCache]);

  return (
    <div ref={cardRef} className={styles.card}>
      {image && imageOk ? (
        <button
          className={styles.cardImageWrap}
          onClick={() => onOpen(item)}
          aria-label={item.title}
        >
          <img
            className={styles.cardImage}
            src={image}
            alt=""
            onError={() => setImageOk(false)}
          />
        </button>
      ) : null}
      <button className={styles.cardMain} onClick={() => onOpen(item)}>
        <div className={styles.cardMeta}>
          <span className={styles.cardSource}>{item.source}</span>
          {item.publishedAt ? (
            <span className={styles.cardTime}>{timeAgo(item.publishedAt)}</span>
          ) : null}
          <span className={styles.cardTopic}>{item.topic}</span>
        </div>
        <div className={styles.cardTitle}>{item.title}</div>
        {item.snippet ? (
          <div className={styles.cardSnippet}>{item.snippet}</div>
        ) : null}
      </button>
      <div className={styles.cardActions}>
        <Button variant="secondary" size="default" onClick={() => onSave(item)}>
          {t['com.notesgraph.discover.save']()}
        </Button>
      </div>
    </div>
  );
};

/**
 * The interests read from the user's notes that the feed is searching, with
 * a switch to leave them out. Each topic is grouped by kind so it's clear
 * which come straight from the notes and which are there to branch out.
 */
const InterestsRow = ({
  enabled,
  onToggle,
  interests,
  topics,
}: {
  enabled: boolean;
  onToggle: () => void;
  interests: UserInterests | null;
  topics: string[];
}) => {
  const t = useI18n();
  const groups = useMemo(() => {
    const general = new Set(interests?.general.map(i => i.label));
    const discover = new Set(interests?.discover);
    return [
      {
        kind: 'specific',
        label: t['com.notesgraph.discover.interests.specific'](),
        topics: topics.filter(x => !general.has(x) && !discover.has(x)),
      },
      {
        kind: 'general',
        label: t['com.notesgraph.discover.interests.general'](),
        topics: topics.filter(x => general.has(x)),
      },
      {
        kind: 'discover',
        label: t['com.notesgraph.discover.interests.discover'](),
        topics: topics.filter(x => discover.has(x)),
      },
    ];
  }, [interests, topics, t]);

  return (
    <div className={styles.interests}>
      <label className={styles.interestsToggle}>
        <Checkbox checked={enabled} onChange={onToggle} />
        {t['com.notesgraph.discover.interests.toggle']()}
      </label>
      {enabled
        ? groups.map(group =>
            group.topics.length ? (
              <div key={group.kind} className={styles.interestsGroup}>
                <span className={styles.interestsLabel}>{group.label}</span>
                {group.topics.map(topic => (
                  <span key={topic} className={styles.interestChip}>
                    {topic}
                  </span>
                ))}
              </div>
            ) : null
          )
        : null}
    </div>
  );
};

const DiscoverPage = () => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;
  const globalCache = useService(GlobalCacheService).globalCache;
  const tagService = useService(TagService);
  const workspaceId = useService(WorkspaceService).workspace.id;

  const [manualTopics, setManualTopics] = useState<string[]>(() =>
    loadTopics()
  );
  const [draft, setDraft] = useState<string>(() => loadTopics().join(', '));
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [useInterests, setUseInterests] = useState(() => loadUseInterests());
  const [interests, setInterests] = useState<UserInterests | null>(() =>
    loadInterests(globalCache, workspaceId)
  );

  // Re-read the notes for interests when there are none stored yet or the
  // stored ones are more than a day old.
  useEffect(() => {
    const stored = loadInterests(globalCache, workspaceId);
    setInterests(stored);
    if (stored && Date.now() - stored.computedAt <= INTERESTS_MAX_AGE_MS) {
      return;
    }
    let cancelled = false;
    readNotesSnapshot(docsService, tagService)
      .then(snapshot => {
        const derived = deriveInterests(snapshot);
        saveInterests(globalCache, workspaceId, derived);
        if (!cancelled) setInterests(derived);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docsService, tagService, globalCache, workspaceId]);

  const interestTopics = useMemo(
    () =>
      useInterests && interests
        ? interestSearchTopics(interests, manualTopics)
        : [],
    [useInterests, interests, manualTopics]
  );
  const topics = useMemo(
    () => [...manualTopics, ...interestTopics],
    [manualTopics, interestTopics]
  );

  const toggleInterests = useCallback(() => {
    setUseInterests(prev => {
      saveUseInterests(!prev);
      return !prev;
    });
  }, []);

  const topicsKey = useMemo(() => topics.join('|'), [topics]);

  // Records from the virtual folders (email, Slack…), mixed in with the news.
  // They are already stored locally, so they come from the store, not the
  // news cache, and update live as the folders re-crawl.
  const virtualViewsService = useService(VirtualViewsService);
  const views = useLiveData(virtualViewsService.views.views$);
  const virtualItems = useLiveData(
    useMemo(
      () => LiveData.from(virtualViewsService.watchAllItems(), []),
      [virtualViewsService]
    )
  );
  const records = useMemo(
    () => virtualItemsToFeed(virtualItems ?? [], views ?? []),
    [virtualItems, views]
  );
  const feed = useMemo(
    () => interleaveFeed(topics.length ? items : [], records),
    [items, records, topics.length]
  );

  const refresh = useCallback(
    async (activeTopics: string[], showLoading = true) => {
      if (activeTopics.length === 0) {
        setItems([]);
        return;
      }
      if (showLoading) setLoading(true);
      setError(false);
      try {
        const feed = await fetchDiscoverFeed(activeTopics);
        setItems(feed);
        setError(feed.length === 0);
        saveCachedFeed(globalCache, activeTopics.join('|'), feed);
      } catch {
        setError(true);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [globalCache]
  );

  useEffect(() => {
    const activeTopics = topicsKey ? topicsKey.split('|') : [];
    if (activeTopics.length === 0) {
      setItems([]);
      return;
    }
    // Show the cached feed instantly, then pull a fresh one only when it's
    // missing or older than a day (the daily refresh). If we already have
    // something to show, refresh quietly in the background (no full spinner).
    const cached = loadCachedFeed(globalCache, topicsKey);
    if (cached) {
      setItems(cached.items);
      setError(false);
    }
    const stale = !cached || Date.now() - cached.fetchedAt > FEED_MAX_AGE_MS;
    if (stale) {
      refresh(activeTopics, !cached).catch(console.error);
    }
  }, [topicsKey, globalCache, refresh]);

  // "Load more": pull a fresh feed on demand and append any items we haven't
  // shown yet, with a spinner on the button while it runs.
  const loadMore = useCallback(async () => {
    if (topics.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const fresh = await fetchDiscoverFeed(topics);
      setItems(prev => {
        const seen = new Set(prev.map(existing => existing.id));
        return [...prev, ...fresh.filter(item => !seen.has(item.id))];
      });
    } catch {
      // keep the existing items on failure
    } finally {
      setLoadingMore(false);
    }
  }, [topics, loadingMore]);

  const applyTopics = useCallback(() => {
    const parsed = parseTopicsInput(draft);
    saveTopics(parsed);
    setManualTopics(parsed);
    setDraft(parsed.join(', '));
  }, [draft]);

  const onOpen = useCallback((item: DiscoverItem) => {
    window.open(item.link, '_blank', 'noopener,noreferrer');
  }, []);

  const onSave = useCallback(
    (item: DiscoverItem) => {
      docsService
        .createDocFromSharedText(item.link, item.title)
        .then(docId => {
          notify.success({ title: t['com.notesgraph.discover.saved']() });
          workbench.openDoc(docId, { at: 'active' });
        })
        .catch(() =>
          notify.error({ title: t['com.notesgraph.discover.saveFailed']() })
        );
    },
    [docsService, workbench, t]
  );

  return (
    <>
      <ViewTitle title={t['com.notesgraph.discover.title']()} />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <div className={styles.header}>
          <Input
            className={styles.topicsInput}
            placeholder={t['com.notesgraph.discover.topics.placeholder']()}
            value={draft}
            onChange={setDraft}
            onEnter={applyTopics}
          />
          <Button variant="primary" size="default" onClick={applyTopics}>
            {t['com.notesgraph.discover.update']()}
          </Button>
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          <InterestsRow
            enabled={useInterests}
            onToggle={toggleInterests}
            interests={interests}
            topics={interestTopics}
          />
          {feed.length === 0 ? (
            <div className={styles.status}>
              {topics.length === 0
                ? t['com.notesgraph.discover.empty']()
                : error && !loading
                  ? t['com.notesgraph.discover.error']()
                  : t['com.notesgraph.discover.loading']()}
            </div>
          ) : (
            <>
              <div className={styles.feed}>
                {feed.map(item => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    onOpen={onOpen}
                    onSave={onSave}
                  />
                ))}
              </div>
              {items.length > 0 ? (
                <div className={styles.loadMore}>
                  <Button
                    variant="secondary"
                    size="default"
                    loading={loadingMore}
                    disabled={loadingMore}
                    onClick={() => {
                      loadMore().catch(console.error);
                    }}
                  >
                    {t['com.notesgraph.discover.loadMore']()}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <DiscoverPage />;
};
