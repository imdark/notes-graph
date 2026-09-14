import { toast } from '@notesgraph/component';
import {
  AiBackendService,
  detectWebGPU,
  LocalLLMService,
} from '@notesgraph/core/modules/ai-local';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { HomeDocService } from '@notesgraph/core/modules/home-doc';
import { JournalService } from '@notesgraph/core/modules/journal';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';
import {
  catchError,
  combineLatest,
  debounceTime,
  defer,
  distinctUntilChanged,
  map,
  type Observable,
  of,
  startWith,
  switchMap,
} from 'rxjs';

// Degrade to a fallback instead of erroring: an errored source poisons the
// LiveData, and useLiveData re-throws poison during render — which unmounts
// the whole doc page via the error boundary a few seconds after opening.
function orElse<T>(fallback: T) {
  return catchError<T, Observable<T>>(err => {
    console.error('[NG-DIAG suggest-parent] query failed:', err);
    return of(fallback);
  });
}

export interface ParentCandidate {
  docId: string;
  title: string;
}

/**
 * In NotesGraph a doc's "parent" is any doc that links to it (a `LinkedPage`
 * reference). A doc is therefore "parentless" when nothing links to it — the
 * same notion the sidebar uses to collect orphans under the Home > Inbox node.
 * The Home root itself is never treated as parentless.
 */
export function useIsParentless(docId: string | undefined): boolean {
  const docsSearch = useService(DocsSearchService);
  const homeDoc = useService(HomeDocService);
  const homeDocId = useLiveData(homeDoc.homeDocId$);

  const parentless$ = useMemo(() => {
    if (!docId) return new LiveData(false);
    // Default `false` (has a parent) so the banner never flashes before the
    // backlink query resolves.
    return LiveData.from(
      docsSearch
        .watchBacklinksFrom(docId)
        .pipe(
          map(backlinks => backlinks.length === 0),
          orElse(false)
        ),
      false
    );
  }, [docsSearch, docId]);
  const noBacklinks = useLiveData(parentless$);

  return !!docId && docId !== homeDocId && noBacklinks;
}

/**
 * The doc's current parents — every doc that links to it. Works for any doc
 * (open or not) so the parent bar can list and manage them.
 */
export function useCurrentParents(
  docId: string | undefined
): ParentCandidate[] {
  const docsSearch = useService(DocsSearchService);
  const parents$ = useMemo(() => {
    if (!docId) return new LiveData<ParentCandidate[]>([]);
    return LiveData.from(
      docsSearch
        .watchBacklinksFrom(docId)
        .pipe(
          map(parents =>
            parents.map(p => ({ docId: p.docId, title: p.title || 'Untitled' }))
          ),
          orElse([] as ParentCandidate[])
        ),
      []
    );
  }, [docsSearch, docId]);
  return useLiveData(parents$);
}

/**
 * The chain of ancestors for `docId` — walk up the first parent (backlink) at
 * each level, cycle-guarded and depth-capped. Returned top-ancestor first (…so
 * it reads left-to-right as a breadcrumb above the title, ending at the doc).
 */
export function useParentChain(
  docId: string | undefined,
  maxDepth = 5
): ParentCandidate[] {
  const docsSearch = useService(DocsSearchService);
  const chain$ = useMemo(() => {
    if (!docId) return new LiveData<ParentCandidate[]>([]);
    const walk = (
      id: string,
      seen: Set<string>,
      depth: number
    ): Observable<ParentCandidate[]> => {
      if (depth <= 0) return of([]);
      return docsSearch.watchBacklinksFrom(id).pipe(
        switchMap(parents => {
          const next = parents.find(p => !seen.has(p.docId));
          if (!next) return of([] as ParentCandidate[]);
          seen.add(next.docId);
          const crumb: ParentCandidate = {
            docId: next.docId,
            title: next.title || 'Untitled',
          };
          return walk(next.docId, seen, depth - 1).pipe(
            map(higher => [...higher, crumb])
          );
        }),
        orElse([] as ParentCandidate[])
      );
    };
    return LiveData.from(walk(docId, new Set([docId]), maxDepth), []);
  }, [docsSearch, docId]);
  return useLiveData(chain$);
}

/**
 * Rank likely parent notes for `docId`: docs whose title or body relate to this
 * note (via the FTS index), excluding itself, its existing parents (backlinks),
 * and its own children (to avoid obvious cycles). Title matches rank above body
 * matches. Rides on the same indexer as search, so it's cheap and works on the
 * server index for cloud workspaces.
 */
export function useSuggestedParents(
  docId: string | undefined,
  limit = 3
): ParentCandidate[] {
  const docsService = useService(DocsService);
  const docsSearch = useService(DocsSearchService);
  const journalService = useService(JournalService);

  const suggestions$ = useMemo(() => {
    if (!docId) return new LiveData<ParentCandidate[]>([]);
    const record$ = docsService.list.doc$(docId);
    return LiveData.from(
      record$.pipe(
        switchMap(record => (record ? record.title$ : of(''))),
        map(rawTitle => (rawTitle ?? '').trim()),
        distinctUntilChanged(),
        // let the title settle while typing before re-querying
        debounceTime(400),
        switchMap(query => {
          if (query.length < 2) return of([] as ParentCandidate[]);
          return combineLatest([
            docsSearch.searchTitle$(query).pipe(orElse([] as string[])),
            docsSearch.search$(query).pipe(
              orElse([] as { docId: string; title: string }[])
            ),
            docsSearch.watchBacklinksFrom(docId).pipe(
              orElse([] as { docId: string }[])
            ),
            docsSearch.watchRefsFrom(docId).pipe(
              orElse([] as { docId: string }[])
            ),
            // Journal (daily) pages are a poor parent — a note doesn't belong
            // "under" a calendar day — so exclude every journal doc from the
            // suggestions. Uses the app's first-class journal marker.
            journalService.allJournalDocIds$,
          ]).pipe(
            map(([titleIds, bodyMatches, parents, children, journalIds]) => {
              const exclude = new Set<string>([docId]);
              for (const p of parents) exclude.add(p.docId);
              for (const c of children) exclude.add(c.docId);
              for (const j of journalIds) exclude.add(j);

              const ordered = [
                ...titleIds,
                ...bodyMatches.map(m => m.docId),
              ];
              const seen = new Set<string>();
              const out: ParentCandidate[] = [];
              for (const id of ordered) {
                if (exclude.has(id) || seen.has(id)) continue;
                seen.add(id);
                const record = docsService.list.doc$(id).value;
                if (!record) continue; // not a real/loaded doc
                out.push({ docId: id, title: record.title$.value || 'Untitled' });
                if (out.length >= limit) break;
              }
              return out;
            })
          );
        }),
        orElse([] as ParentCandidate[])
      ),
      []
    );
  }, [docsService, docsSearch, journalService, docId, limit]);

  return useLiveData(suggestions$);
}

const normalizeTitle = (title: string) =>
  title.trim().toLowerCase().replace(/\s+/g, ' ');

/** Levenshtein edit distance, capped implicitly by the short titles we compare. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Drop a plural "s" so "networks" and "network" compare equal. */
function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;
}

/** Words of a normalized title, singularized — the unit fuzzy matching aligns on. */
function titleTokens(normalized: string): string[] {
  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize);
}

/** Two words are "the same word with a typo" — exact for short words, else ~1 edit per 3 chars. */
function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 3) return false; // short words must match exactly
  return editDistance(a, b) <= Math.max(1, Math.floor(maxLen * 0.34));
}

/**
 * Whether two titles are near-duplicates — the same words (in any order, allowing
 * plural/singular) with at most a small typo per word. Conservative on purpose:
 * combine is a destructive-ish offer, so it requires the same word count and a
 * per-word match rather than a loose bag-of-words overlap. Handles the motivating
 * case "Anelizing network" ~ "analyzing networks".
 */
function titlesAreNearDuplicate(aTokens: string[], bTokens: string[]): boolean {
  if (aTokens.length === 0 || aTokens.length !== bTokens.length) return false;
  const remaining = [...bTokens];
  for (const token of aTokens) {
    const idx = remaining.findIndex(other => tokensClose(token, other));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

// prettier-ignore
const TOPIC_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do',
  'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'make',
  'me', 'more', 'most', 'my', 'need', 'no', 'nor', 'not', 'now', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'still', 'such', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'todo', 'too', 'under', 'until', 'untitled', 'up', 'us',
  'use', 'used', 'using', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you',
  'your',
]);

const tokenizeWords = (text: string) =>
  text.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? [];

const isCapitalized = (word: string) => /^[A-Z]/.test(word);

/**
 * Heuristic topic extraction from a note's title + indexed body text. Favors
 * capitalized phrases (named things), title words, and recurring terms —
 * cheap, deterministic, and index-backed, so it works offline and on mobile
 * without any model. Candidates whose normalized form fails `isAvailable`
 * (e.g. a doc with that title already exists) are dropped: an existing doc is
 * the parent-suggestion flow's job, a topic is by definition a *new* node.
 */
function extractTopics(
  title: string,
  body: string,
  isAvailable: (normalized: string) => boolean,
  limit: number
): string[] {
  const scores = new Map<string, { display: string; score: number }>();
  const bump = (display: string, amount: number) => {
    const key = normalizeTitle(display);
    if (key.length < 3 || TOPIC_STOPWORDS.has(key)) return;
    const entry = scores.get(key);
    if (entry) entry.score += amount;
    else scores.set(key, { display, score: amount });
  };

  // Title words are the strongest signal of what the note is "about".
  for (const word of tokenizeWords(title)) {
    if (word.length < 3 || TOPIC_STOPWORDS.has(word.toLowerCase())) continue;
    bump(word[0].toUpperCase() + word.slice(1), 2.5);
  }

  const text = body.slice(0, 4000);
  const unigramCounts = new Map<string, string>();
  const unigramFreq = new Map<string, number>();

  // Split on sentence-ish boundaries so capitalized runs can't span them.
  for (const segment of text.split(/[.!?;:,\n\r()[\]{}"“”|]+/)) {
    const words = tokenizeWords(segment);

    // Capitalized runs read as proper nouns / named topics. A lone
    // capitalized word opening a segment is usually just sentence case, so
    // it doesn't count (recurring ones are caught by the frequency pass).
    let run: string[] = [];
    let runStart = 0;
    const flushRun = (endIndex: number) => {
      if (run.length === 0) return;
      if (run.length > 1 && run.length <= 4) {
        bump(run.join(' '), 3);
      } else if (
        run.length === 1 &&
        run[0].length >= 3 &&
        !(runStart === 0 && endIndex === 1)
      ) {
        bump(run[0], 2);
      }
      run = [];
    };
    for (let i = 0; i < words.length; i++) {
      if (isCapitalized(words[i])) {
        if (run.length === 0) runStart = i;
        run.push(words[i]);
      } else {
        flushRun(i);
      }
    }
    flushRun(words.length);

    // Recurring plain terms (counted across the whole body below).
    for (const word of words) {
      const lower = word.toLowerCase();
      if (word.length < 4 || TOPIC_STOPWORDS.has(lower)) continue;
      unigramFreq.set(lower, (unigramFreq.get(lower) ?? 0) + 1);
      if (!unigramCounts.has(lower)) {
        unigramCounts.set(lower, word[0].toUpperCase() + word.slice(1));
      }
    }
  }

  for (const [lower, count] of unigramFreq) {
    if (count >= 3) {
      const display = unigramCounts.get(lower);
      if (display) bump(display, count * 0.5);
    }
  }

  const fullTitle = normalizeTitle(title);
  const ranked = Array.from(scores.entries())
    // score < 2 is a single weak signal — not enough to suggest on
    .filter(
      ([key, entry]) =>
        entry.score >= 2 && key !== fullTitle && isAvailable(key)
    )
    .sort((a, b) => b[1].score - a[1].score);

  // Suppress overlapping candidates ("VXLAN" vs "VXLAN MTU") — keep the
  // higher-scoring one.
  const picked: string[] = [];
  const out: string[] = [];
  for (const [key, entry] of ranked) {
    if (out.length >= limit) break;
    const words = ` ${key} `;
    if (picked.some(p => words.includes(` ${p} `) || ` ${p} `.includes(words))) {
      continue;
    }
    picked.push(key);
    out.push(entry.display);
  }
  return out;
}

const AI_TOPIC_SYSTEM_PROMPT = `You name topics for organizing notes in a personal knowledge graph.
Given a note, reply with up to 3 topic names, one per line.
Rules:
- 1 to 3 words each, Title Case
- no punctuation, numbering, or explanations
- broad enough to group several related notes, but specific to this note's subject
- never repeat the note's own title`;

/** Parse the model reply into clean, short topic strings. */
function parseAiTopics(reply: string): string[] {
  return reply
    .split('\n')
    .map(line =>
      line
        .replace(/^[\s\-–*•\d.):]+/, '')
        .replace(/^["“”'`]+|["“”'`.,;*]+$/g, '')
        .trim()
    )
    .filter(
      line =>
        line.length >= 3 &&
        line.length <= 40 &&
        !line.endsWith(':') &&
        line.split(/\s+/).length <= 3
    )
    .slice(0, 5);
}

// The 1B on-device model handles one generation at a time — serialize requests
// so rapid doc switches can't interleave completions.
let aiTopicQueue: Promise<unknown> = Promise.resolve();
const enqueueAiTopics = <T>(job: () => Promise<T>): Promise<T> => {
  const run = aiTopicQueue.then(job, job);
  aiTopicQueue = run.catch(() => {});
  return run;
};

// One generation per (doc, content) per session — revisiting a doc or getting
// re-subscribed by rxjs must not re-run the model on identical input.
const aiTopicCache = new Map<
  string,
  { input: string; result: Promise<string[] | null> }
>();

/**
 * Ask the on-device model (WebLLM) for short topics. Resolves `null` whenever
 * the model can't or shouldn't run, so callers fall back to the heuristic:
 * - model not loaded and the user hasn't opted into local AI (backend
 *   setting), or
 * - WebGPU unavailable, or
 * - generation fails / returns nothing usable.
 * If the user *has* opted into local AI, this loads the model on demand
 * (`ensureLoaded` downloads once and is cached by the browser).
 */
function aiSuggestTopics(
  llm: LocalLLMService,
  aiBackend: AiBackendService,
  docId: string,
  title: string,
  body: string
): Promise<string[] | null> {
  const input = `${title}\n${body}`;
  const cached = aiTopicCache.get(docId);
  if (cached && cached.input === input) return cached.result;

  const result = (async () => {
    if (llm.status$.value.state !== 'ready') {
      if (aiBackend.backend !== 'local') return null;
      const gpu = await detectWebGPU();
      if (!gpu.available) return null;
    }
    return enqueueAiTopics(async () => {
      await llm.ensureLoaded();
      const reply = await llm.complete(
        [
          { role: 'system', content: AI_TOPIC_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Note title: ${title || '(untitled)'}\n\nNote content:\n${body.slice(0, 2000)}`,
          },
        ],
        { temperature: 0.2 }
      );
      const topics = parseAiTopics(reply);
      return topics.length > 0 ? topics : null;
    });
  })().catch(err => {
    console.error('[NG-DIAG suggest-parent] ai topics failed:', err);
    return null;
  });
  aiTopicCache.set(docId, { input, result });
  return result;
}

/**
 * Suggested *new* topic nodes for `docId`. The heuristic extraction
 * ({@link extractTopics}) emits instantly; when the on-device model is
 * available its topics replace the heuristic ones ({@link aiSuggestTopics}).
 * Unlike {@link useSuggestedParents} these don't exist yet — pair with
 * {@link useCreateTopicParent}, which creates the topic doc and links the
 * note under it.
 */
export function useSuggestedTopics(
  docId: string | undefined,
  limit = 3
): string[] {
  const docsService = useService(DocsService);
  const llm = useService(LocalLLMService);
  const aiBackend = useService(AiBackendService);

  const topics$ = useMemo(() => {
    if (!docId) return new LiveData<string[]>([]);
    const record$ = docsService.list.doc$(docId);
    // Topics are derived from the TITLE only (not the body) and settle on a
    // long debounce, so the "Create new parent" chips stay put while you type
    // note content — they change only when you rename the note. Fixes the
    // distracting "changes while typing" churn.
    const title$ = record$.pipe(
      switchMap((record): Observable<string> =>
        record ? record.title$ : of('')
      ),
      map(rawTitle => (rawTitle ?? '').trim()),
      debounceTime(800),
      distinctUntilChanged()
    );
    return LiveData.from(
      title$.pipe(
        switchMap(title => {
          if (title.length < 2) return of([] as string[]);
          // Snapshot existing (non-trashed) titles so we never offer to
          // "create" a topic node that already exists as a doc.
          const taken = new Set<string>();
          for (const record of docsService.list.docs$.value) {
            if (record.trash$.value) continue;
            const existing = normalizeTitle(record.title$.value || '');
            if (existing) taken.add(existing);
          }
          const isAvailable = (key: string) =>
            !taken.has(key) && key !== normalizeTitle(title);
          const heuristic = extractTopics(title, '', isAvailable, limit);
          // Heuristic topics render immediately; the model's (better) ones
          // swap in when generation finishes. A new title emission cancels the
          // pending swap via switchMap.
          return defer(() =>
            aiSuggestTopics(llm, aiBackend, docId, title, '')
          ).pipe(
            map(ai => {
              if (!ai) return heuristic;
              const out: string[] = [];
              const seen = new Set<string>();
              for (const topic of ai) {
                const key = normalizeTitle(topic);
                if (!key || seen.has(key) || !isAvailable(key)) continue;
                seen.add(key);
                out.push(topic);
                if (out.length >= limit) break;
              }
              return out.length > 0 ? out : heuristic;
            }),
            startWith(heuristic),
            orElse(heuristic)
          );
        }),
        distinctUntilChanged(
          (prev, curr) =>
            prev.length === curr.length && prev.every((t, i) => t === curr[i])
        ),
        orElse([] as string[])
      ),
      []
    );
  }, [docsService, llm, aiBackend, docId, limit]);

  return useLiveData(topics$);
}

/**
 * Create a new topic doc titled `topic` and link `childId` under it — the
 * "generate a new parent node" path for topic suggestions.
 */
export function useCreateTopicParent() {
  const docsService = useService(DocsService);
  return useCallback(
    (topic: string, childId: string) => {
      let record;
      try {
        record = docsService.createDoc({ title: topic });
      } catch (err) {
        console.error('[NG-DIAG suggest-parent] create topic failed:', err);
        toast('Could not create topic');
        return;
      }
      docsService
        .addLinkedDoc(record.id, childId)
        .then(() => {
          toast(`Created “${topic}” and added this note under it`);
        })
        .catch(err => {
          console.error('[NG-DIAG suggest-parent] link topic failed:', err);
          toast('Could not add under new topic');
        });
    },
    [docsService]
  );
}

/**
 * Docs that look like duplicates of `docId`: a near-identical title (same words
 * in any order, tolerant of plural/singular and a small typo per word), not
 * trashed, not itself. Typo tolerance is why this scans titles client-side
 * rather than riding the FTS index — the index can't retrieve "analyzing
 * networks" from a misspelled "Anelizing network". The fuzzy match is
 * deliberately tight (same word count, per-word closeness) so combine is only
 * offered for genuine duplicates, not merely related notes.
 */
export function useDuplicateCandidates(
  docId: string | undefined,
  limit = 2
): ParentCandidate[] {
  const docsService = useService(DocsService);

  const duplicates$ = useMemo(() => {
    if (!docId) return new LiveData<ParentCandidate[]>([]);
    const self$ = docsService.list.doc$(docId);
    return LiveData.from(
      self$.pipe(
        switchMap(record => (record ? record.title$ : of(''))),
        map(rawTitle => normalizeTitle(rawTitle ?? '')),
        distinctUntilChanged(),
        debounceTime(400),
        switchMap(title => {
          const selfTokens = titleTokens(title);
          if (selfTokens.length === 0) return of([] as ParentCandidate[]);
          return docsService.list.docs$.pipe(
            switchMap(records => {
              const others = records.filter(r => r.id !== docId);
              if (others.length === 0) return of([] as ParentCandidate[]);
              return combineLatest(
                others.map(r =>
                  combineLatest([r.title$, r.trash$]).pipe(
                    map(([t, trash]) => ({
                      id: r.id,
                      title: t || '',
                      trash: !!trash,
                    }))
                  )
                )
              ).pipe(
                debounceTime(200),
                map(rows => {
                  const out: ParentCandidate[] = [];
                  for (const row of rows) {
                    if (row.trash) continue;
                    const tokens = titleTokens(normalizeTitle(row.title));
                    if (!titlesAreNearDuplicate(selfTokens, tokens)) continue;
                    out.push({ docId: row.id, title: row.title || 'Untitled' });
                    if (out.length >= limit) break;
                  }
                  return out;
                })
              );
            }),
            orElse([] as ParentCandidate[])
          );
        })
      ),
      []
    );
  }, [docsService, docId, limit]);

  return useLiveData(duplicates$);
}

/**
 * Merge the current doc into `targetId` (append content + union tags), trash
 * the current doc, and navigate to the merged target.
 */
export function useCombineWithDuplicate() {
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;
  return useCallback(
    (targetId: string, sourceId: string, targetTitle?: string) => {
      docsService
        .mergeDocInto(sourceId, targetId)
        .then(() => {
          toast(`Combined into “${targetTitle || 'note'}”`);
          workbench.openDoc(targetId);
        })
        .catch(err => {
          console.error('[NG-DIAG suggest-parent] combine failed:', err);
          toast('Could not combine notes');
        });
    },
    [docsService, workbench]
  );
}

/**
 * Link `childId` under `parentId` (add, not move — the graph allows a note to
 * have several parents). Surfaces a toast so the action is visible even though
 * the change lands in the parent doc rather than the one on screen.
 */
export function useSetParent() {
  const docsService = useService(DocsService);
  return useCallback(
    (parentId: string, childId: string, parentTitle?: string) => {
      void docsService
        .addLinkedDoc(parentId, childId)
        .then(() => {
          toast(`Added under “${parentTitle || 'note'}”`);
        })
        .catch(err => {
          console.error('Failed to set parent', err);
          toast('Could not set parent');
        });
    },
    [docsService]
  );
}

/** Unlink `childId` from a specific parent (used to remove/swap parents). */
export function useRemoveParent() {
  const docsService = useService(DocsService);
  return useCallback(
    (parentId: string, childId: string, parentTitle?: string) => {
      void docsService
        .removeLinkedDoc(parentId, childId)
        .then(() => {
          toast(`Removed from “${parentTitle || 'note'}”`);
        })
        .catch(err => {
          console.error('Failed to remove parent', err);
          toast('Could not remove parent');
        });
    },
    [docsService]
  );
}
