import { Button, Checkbox, Input, notify } from '@notesgraph/component';
import { FetchService } from '@notesgraph/core/modules/cloud';
import { DocsService } from '@notesgraph/core/modules/doc';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { JournalService } from '@notesgraph/core/modules/journal';
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
  DEFAULT_TOPICS,
  type DiscoverItem,
  fetchCardImage,
  fetchDiscoverFeed,
  fetchServerTopics,
  isFeedStale,
  loadCachedFeed,
  loadSavedTopics,
  loadTopics,
  saveCachedFeed,
  saveServerTopics,
  saveTopics,
} from './feed';
import {
  addInterest,
  AREA_LABELS,
  deriveInterests,
  type InterestEdits,
  INTERESTS_MAX_AGE_MS,
  interestSearchTopics,
  loadInterestEdits,
  loadInterests,
  loadUseInterests,
  NO_EDITS,
  type NotesSnapshot,
  removeInterest,
  saveInterestEdits,
  saveInterests,
  saveUseInterests,
  type UserInterests,
} from './interests';
import {
  appendNewToFeed,
  interleaveFeed,
  nextShownFeed,
  type ShownFeed,
  virtualItemsToFeed,
} from './records';
import {
  type Dismissal,
  dismissalOf,
  fetchServerDismissals,
  interestsToDrop,
  loadDismissals,
  mergeDismissals,
  rankFeed,
  saveDismissals,
  saveServerDismissals,
  whyShown,
} from './relevance';
import { TopicsPicker } from './topics-picker';

/** How long the picker waits after the last change before refetching. */
const TOPICS_COMMIT_DELAY_MS = 700;

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
  why,
  onDismiss,
}: {
  item: DiscoverItem;
  onOpen: (item: DiscoverItem) => void;
  onSave: (item: DiscoverItem) => void;
  /** Why it's in the feed; null hides "Why this?" and "Not interesting". */
  why: string[] | null;
  onDismiss: (item: DiscoverItem) => void;
}) => {
  const t = useI18n();
  const [showWhy, setShowWhy] = useState(false);
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
      {why && showWhy ? (
        <ul className={styles.cardWhy} data-testid="discover-why">
          {why.map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.cardActions}>
        {why ? (
          <>
            <Button
              variant="plain"
              size="default"
              onClick={() => setShowWhy(prev => !prev)}
              data-testid="discover-why-toggle"
            >
              {showWhy ? 'Hide why' : 'Why this?'}
            </Button>
            <Button
              variant="plain"
              size="default"
              tooltip="Hide this story, and show fewer like it"
              onClick={() => onDismiss(item)}
              data-testid="discover-not-interesting"
            >
              Not interesting
            </Button>
          </>
        ) : null}
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
  edits,
  topics,
  regenerating,
  onRegenerate,
  onRemove,
  onAdd,
  onReset,
}: {
  enabled: boolean;
  onToggle: () => void;
  interests: UserInterests | null;
  edits: InterestEdits;
  topics: string[];
  regenerating: boolean;
  onRegenerate: () => void;
  onRemove: (topic: string) => void;
  onAdd: (topic: string) => void;
  onReset: () => void;
}) => {
  const t = useI18n();
  const [draft, setDraft] = useState('');
  const groups = useMemo(() => {
    const general = new Set(interests?.general.map(i => i.label));
    const discover = new Set(interests?.discover);
    const added = new Set(edits.added);
    return [
      {
        kind: 'added',
        label: t['com.notesgraph.discover.interests.added'](),
        topics: topics.filter(x => added.has(x)),
      },
      {
        kind: 'specific',
        label: t['com.notesgraph.discover.interests.specific'](),
        topics: topics.filter(
          x => !added.has(x) && !general.has(x) && !discover.has(x)
        ),
      },
      {
        kind: 'general',
        label: t['com.notesgraph.discover.interests.general'](),
        topics: topics.filter(x => !added.has(x) && general.has(x)),
      },
      {
        kind: 'discover',
        label: t['com.notesgraph.discover.interests.discover'](),
        topics: topics.filter(x => !added.has(x) && discover.has(x)),
      },
    ];
  }, [interests, edits.added, topics, t]);

  const submit = useCallback(() => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft('');
  }, [draft, onAdd]);

  const edited = edits.added.length > 0 || edits.removed.length > 0;

  return (
    <div className={styles.interests}>
      <div className={styles.interestsBar}>
        <label className={styles.interestsToggle}>
          <Checkbox checked={enabled} onChange={onToggle} />
          {t['com.notesgraph.discover.interests.toggle']()}
        </label>
        {enabled ? (
          <>
            <Button
              variant="plain"
              size="default"
              loading={regenerating}
              disabled={regenerating}
              onClick={onRegenerate}
            >
              {t['com.notesgraph.discover.interests.regenerate']()}
            </Button>
            {edited ? (
              <Button variant="plain" size="default" onClick={onReset}>
                {t['com.notesgraph.discover.interests.reset']()}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {enabled ? (
        <>
          {groups.map(group =>
            group.topics.length ? (
              <div key={group.kind} className={styles.interestsGroup}>
                <span className={styles.interestsLabel}>{group.label}</span>
                {group.topics.map(topic => (
                  <span key={topic} className={styles.interestChip}>
                    {topic}
                    <button
                      type="button"
                      className={styles.interestRemove}
                      aria-label={t['com.notesgraph.discover.interests.remove'](
                        {
                          topic,
                        }
                      )}
                      onClick={() => onRemove(topic)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null
          )}
          <Input
            className={styles.interestAdd}
            placeholder={t[
              'com.notesgraph.discover.interests.add.placeholder'
            ]()}
            value={draft}
            onChange={setDraft}
            onEnter={submit}
          />
        </>
      ) : null}
    </div>
  );
};

const DiscoverPage = () => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const journalService = useService(JournalService);
  const workbench = useService(WorkbenchService).workbench;
  const globalCache = useService(GlobalCacheService).globalCache;
  const tagService = useService(TagService);
  const workspaceId = useService(WorkspaceService).workspace.id;

  const [manualTopics, setManualTopics] = useState<string[]>(() =>
    loadTopics()
  );
  // The picker's selection; it becomes `manualTopics` (and refetches the
  // feed) once the user stops changing it for a moment.
  const [draftTopics, setDraftTopics] = useState<string[]>(manualTopics);
  const fetchService = useService(FetchService);
  // Set once the user changes the picker, so a late server answer can't
  // undo their edit.
  const pickedRef = useRef(false);
  const pickTopics = useCallback((next: string[]) => {
    pickedRef.current = true;
    setDraftTopics(next);
  }, []);

  // The server holds the selection, so other devices and the morning
  // preseed automation use it too. This browser's copy shows first and
  // stands in when signed out or offline. A selection saved only here
  // (before the server kept one) is moved up.
  useEffect(() => {
    let cancelled = false;
    fetchServerTopics(fetchService.fetch)
      .then(async server => {
        if (server === null) {
          const local = loadSavedTopics();
          if (local) await saveServerTopics(fetchService.fetch, local);
          return;
        }
        if (cancelled || pickedRef.current) return;
        saveTopics(server);
        setManualTopics(server);
        setDraftTopics(server);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchService]);
  // The news, tagged with the user selection it was loaded for, so the page
  // can tell a change the user made (start the feed over) from a background
  // update (append to it).
  const [news, setNews] = useState<{
    selection: string | null;
    items: DiscoverItem[];
  }>({ selection: null, items: [] });
  const items = news.items;
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [useInterests, setUseInterests] = useState(() => loadUseInterests());
  const [interests, setInterests] = useState<UserInterests | null>(() =>
    loadInterests(globalCache, workspaceId)
  );

  const [edits, setEdits] = useState<InterestEdits>(() =>
    loadInterestEdits(globalCache, workspaceId)
  );
  const [regenerating, setRegenerating] = useState(false);
  // Counts finished "Regenerate" clicks: their new interests start the feed
  // over, unlike the quiet daily re-read.
  const [regenerations, setRegenerations] = useState(0);

  const readInterests = useCallback(async () => {
    const derived = deriveInterests(
      await readNotesSnapshot(docsService, tagService)
    );
    saveInterests(globalCache, workspaceId, derived);
    return derived;
  }, [docsService, tagService, globalCache, workspaceId]);

  // Re-read the notes for interests when there are none stored yet or the
  // stored ones are more than a day old.
  useEffect(() => {
    const stored = loadInterests(globalCache, workspaceId);
    setInterests(stored);
    setEdits(loadInterestEdits(globalCache, workspaceId));
    if (stored && Date.now() - stored.computedAt <= INTERESTS_MAX_AGE_MS) {
      return;
    }
    let cancelled = false;
    readInterests()
      .then(derived => {
        if (!cancelled) setInterests(derived);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [readInterests, globalCache, workspaceId]);

  const regenerate = useCallback(() => {
    setRegenerating(true);
    readInterests()
      .then(derived => {
        setInterests(derived);
        setRegenerations(n => n + 1);
      })
      .catch(console.error)
      .finally(() => setRegenerating(false));
  }, [readInterests]);

  const updateEdits = useCallback(
    (change: (prev: InterestEdits) => InterestEdits) => {
      setEdits(prev => {
        const next = change(prev);
        saveInterestEdits(globalCache, workspaceId, next);
        return next;
      });
    },
    [globalCache, workspaceId]
  );
  const onRemoveInterest = useCallback(
    (topic: string) => updateEdits(prev => removeInterest(prev, topic)),
    [updateEdits]
  );
  const onAddInterest = useCallback(
    (topic: string) => updateEdits(prev => addInterest(prev, topic)),
    [updateEdits]
  );
  const onResetInterests = useCallback(
    () => updateEdits(() => NO_EDITS),
    [updateEdits]
  );

  const interestTopics = useMemo(
    () =>
      useInterests ? interestSearchTopics(interests, manualTopics, edits) : [],
    [useInterests, interests, manualTopics, edits]
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
  // What the user chose: changing it starts the feed over. Interests re-read
  // in the background change `topicsKey` but not this, so their news is
  // appended instead.
  const selection = useMemo(
    () => JSON.stringify([manualTopics, useInterests, edits, regenerations]),
    [manualTopics, useInterests, edits, regenerations]
  );
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

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
  const latestFeed = useMemo(
    () => interleaveFeed(topics.length ? items : [], records),
    [items, records, topics.length]
  );
  // What is on screen. Updates that arrive while the user reads (a background
  // refresh, a re-crawled email) go at the end rather than reshuffling it.
  const shownRef = useRef<ShownFeed>({ selection: null, items: [] });
  const feed = useMemo(() => {
    shownRef.current = nextShownFeed(
      shownRef.current,
      news.selection,
      latestFeed
    );
    return shownRef.current.items;
  }, [latestFeed, news.selection]);

  // Not interesting: dismissed stories, and fewer like them (relevance.ts).
  const relevanceOn = useLiveData(
    useService(FeatureFlagService).flags.enable_discover_relevance.$
  );
  const [dismissed, setDismissed] = useState<Dismissal[]>(loadDismissals);
  useEffect(() => {
    let cancelled = false;
    fetchServerDismissals(fetchService.fetch)
      .then(server => {
        if (cancelled) return;
        setDismissed(local => {
          const merged = mergeDismissals(server, local);
          saveDismissals(merged);
          // This device dismissed some the server hasn't seen: send them.
          if (merged.length !== server.length) {
            saveServerDismissals(fetchService.fetch, merged).catch(
              console.error
            );
          }
          return merged;
        });
      })
      .catch(() => {
        // Signed out or offline: this device's list stands.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchService]);
  const storeDismissed = useCallback(
    (next: Dismissal[]) => {
      setDismissed(next);
      saveDismissals(next);
      saveServerDismissals(fetchService.fetch, next).catch(console.error);
    },
    [fetchService]
  );
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const onDismiss = useCallback(
    (item: DiscoverItem) => {
      const before = dismissedRef.current;
      storeDismissed(mergeDismissals(before, [dismissalOf(item)]));
      notify({
        title: 'Marked not interesting',
        message: 'You’ll see fewer stories like it.',
        actions: [
          {
            key: 'undo',
            label: 'Undo',
            onClick: () =>
              storeDismissed(
                dismissedRef.current.filter(d => d.id !== item.id)
              ),
          },
        ],
      });
    },
    [storeDismissed]
  );
  const ranked = useMemo(
    () =>
      relevanceOn
        ? rankFeed(feed, dismissed)
        : { items: feed, lowered: new Map(), hidden: 0 },
    [relevanceOn, feed, dismissed]
  );
  const sources = useMemo(
    () => ({ manualTopics, interests, edits }),
    [manualTopics, interests, edits]
  );
  const toDrop = useMemo(
    () =>
      relevanceOn ? interestsToDrop(dismissed, interestTopics)[0] : undefined,
    [relevanceOn, dismissed, interestTopics]
  );

  const refresh = useCallback(
    async (
      activeTopics: string[],
      forSelection: string,
      showLoading = true
    ) => {
      if (showLoading) setLoading(true);
      setError(false);
      try {
        const feed = await fetchDiscoverFeed(activeTopics);
        saveCachedFeed(globalCache, activeTopics.join('|'), feed);
        // A fetch for a selection the user has since left must not put its
        // topics back on screen.
        if (selectionRef.current !== forSelection) return;
        setNews({ selection: forSelection, items: feed });
        setError(feed.length === 0);
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
      setNews({ selection, items: [] });
      return;
    }
    // Show the cached feed instantly, then pull a fresh one only when it's
    // missing or older than a day (the daily refresh). If we already have
    // something to show, refresh quietly in the background (no full spinner).
    const cached = loadCachedFeed(globalCache, topicsKey);
    if (cached) {
      setNews({ selection, items: cached.items });
      setError(false);
    }
    const stale = !cached || isFeedStale(cached.fetchedAt);
    if (stale) {
      refresh(activeTopics, selection, !cached).catch(console.error);
    }
  }, [topicsKey, selection, globalCache, refresh]);

  // "Load more": pull a fresh feed on demand and append any items we haven't
  // shown yet, with a spinner on the button while it runs.
  const loadMore = useCallback(async () => {
    if (topics.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const fresh = await fetchDiscoverFeed(topics);
      setNews(prev => ({
        ...prev,
        items: appendNewToFeed(prev.items, fresh),
      }));
    } catch {
      // keep the existing items on failure
    } finally {
      setLoadingMore(false);
    }
  }, [topics, loadingMore]);

  useEffect(() => {
    if (draftTopics.join('|') === manualTopics.join('|')) return;
    const timer = setTimeout(() => {
      saveTopics(draftTopics);
      setManualTopics(draftTopics);
      saveServerTopics(fetchService.fetch, draftTopics).catch(console.error);
    }, TOPICS_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftTopics, manualTopics, fetchService]);

  const topicSuggestions = useMemo(
    () => [
      ...DEFAULT_TOPICS,
      ...(interests?.specific.map(i => i.label) ?? []),
      ...(interests?.general.map(i => i.label) ?? []),
      ...(interests?.discover ?? []),
      ...AREA_LABELS,
    ],
    [interests]
  );

  const onOpen = useCallback((item: DiscoverItem) => {
    window.open(item.link, '_blank', 'noopener,noreferrer');
  }, []);

  const onSave = useCallback(
    (item: DiscoverItem) => {
      docsService
        .createDocFromSharedText(item.link, item.title)
        .then(docId => {
          journalService.addToTodayJournal(docId).catch(console.error);
          notify.success({ title: t['com.notesgraph.discover.saved']() });
          workbench.openDoc(docId, { at: 'active' });
        })
        .catch(() =>
          notify.error({ title: t['com.notesgraph.discover.saveFailed']() })
        );
    },
    [docsService, journalService, workbench, t]
  );

  return (
    <>
      <ViewTitle title={t['com.notesgraph.discover.title']()} />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <div className={styles.header}>
          <TopicsPicker
            selected={draftTopics}
            suggestions={topicSuggestions}
            onChange={pickTopics}
          />
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          <InterestsRow
            enabled={useInterests}
            onToggle={toggleInterests}
            interests={interests}
            edits={edits}
            topics={interestTopics}
            regenerating={regenerating}
            onRegenerate={regenerate}
            onRemove={onRemoveInterest}
            onAdd={onAddInterest}
            onReset={onResetInterests}
          />
          {toDrop ? (
            <div
              className={styles.dropSuggestion}
              data-testid="discover-drop-interest"
            >
              <span>
                You marked {toDrop.count} stories on “{toDrop.topic}” not
                interesting lately.
              </span>
              <Button
                variant="secondary"
                size="default"
                onClick={() => onRemoveInterest(toDrop.topic)}
              >
                Stop following “{toDrop.topic}”
              </Button>
            </div>
          ) : null}
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
                {ranked.items.map(item => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    onOpen={onOpen}
                    onSave={onSave}
                    why={
                      relevanceOn
                        ? whyShown(item, sources, ranked.lowered.get(item.id))
                        : null
                    }
                    onDismiss={onDismiss}
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
