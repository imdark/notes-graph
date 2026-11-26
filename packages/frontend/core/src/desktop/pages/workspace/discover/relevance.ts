import type { DiscoverItem, ServerFetch } from './feed';
import { type InterestEdits, tokenize, type UserInterests } from './interests';

/**
 * Stories marked "Not interesting", and what follows from them: the story is
 * gone, stories much like it are gone too, ones a little like it and ones
 * from a topic dismissed again and again sink to the end. And, for each
 * story, why it is in the feed at all.
 */

/** A story marked not interesting. Saved per user on the server. */
export interface Dismissal {
  id: string;
  title: string;
  topic: string;
  source: string;
  /** When, epoch ms. */
  at: number;
}

export const dismissalOf = (
  item: DiscoverItem,
  at = Date.now()
): Dismissal => ({
  id: item.id,
  title: item.title,
  topic: item.topic,
  source: item.source,
  at,
});

/** How alike two titles are: shared words over all their words (Jaccard). */
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(tokenize(a));
  const wb = new Set(tokenize(b));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/** At or above this, a story is the dismissed one again (another outlet's take). */
export const SAME_STORY = 0.5;
/** At or above this, it is like one and goes lower. */
export const LIKE_STORY = 0.25;
/** Dismissals from one topic, within RECENT_MS, before its stories sink. */
export const TOPIC_DISMISSALS = 3;
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/** Why a story was moved down, for its "why". */
export type Lowered =
  | { kind: 'like'; title: string }
  | { kind: 'topic'; topic: string; count: number };

export interface RankedFeed {
  items: DiscoverItem[];
  /** The stories moved down, by id. */
  lowered: Map<string, Lowered>;
  /** How many stories were left out as dismissed or the same as one. */
  hidden: number;
}

const topicKey = (topic: string) => topic.trim().toLowerCase();

/** How many stories were dismissed from each topic lately. */
export function topicDismissals(
  dismissed: Dismissal[],
  now = Date.now()
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of dismissed) {
    if (now - d.at > RECENT_MS || !d.topic) continue;
    const key = topicKey(d.topic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The feed with the dismissals applied: dismissed stories and ones that are
 * the same story left out; ones like a dismissed story, or from a topic
 * dismissed TOPIC_DISMISSALS times lately, moved after the rest, in order.
 */
export function rankFeed(
  items: DiscoverItem[],
  dismissed: Dismissal[],
  now = Date.now()
): RankedFeed {
  const ids = new Set(dismissed.map(d => d.id));
  const byTopic = topicDismissals(dismissed, now);
  const kept: DiscoverItem[] = [];
  const sunk: DiscoverItem[] = [];
  const lowered = new Map<string, Lowered>();
  let hidden = 0;
  for (const item of items) {
    if (ids.has(item.id)) {
      hidden++;
      continue;
    }
    let closest: Dismissal | null = null;
    let best = 0;
    for (const d of dismissed) {
      const score = titleSimilarity(item.title, d.title);
      if (score > best) {
        best = score;
        closest = d;
      }
    }
    if (best >= SAME_STORY) {
      hidden++;
      continue;
    }
    const topicCount = byTopic.get(topicKey(item.topic)) ?? 0;
    if (closest && best >= LIKE_STORY) {
      lowered.set(item.id, { kind: 'like', title: closest.title });
      sunk.push(item);
    } else if (item.origin !== 'record' && topicCount >= TOPIC_DISMISSALS) {
      lowered.set(item.id, {
        kind: 'topic',
        topic: item.topic,
        count: topicCount,
      });
      sunk.push(item);
    } else {
      kept.push(item);
    }
  }
  return { items: [...kept, ...sunk], lowered, hidden };
}

/**
 * Interests read from the notes that have had TOPIC_DISMISSALS or more of
 * their stories dismissed lately: offered for removal, strongest case first.
 */
export function interestsToDrop(
  dismissed: Dismissal[],
  interestTopics: string[],
  now = Date.now()
): { topic: string; count: number }[] {
  const byTopic = topicDismissals(dismissed, now);
  return interestTopics
    .map(topic => ({ topic, count: byTopic.get(topicKey(topic)) ?? 0 }))
    .filter(entry => entry.count >= TOPIC_DISMISSALS)
    .sort((a, b) => b.count - a.count);
}

/** What the feed was searched for, to say why a story is in it. */
export interface FeedSources {
  /** Topics the user picked on the page. */
  manualTopics: string[];
  interests: UserInterests | null;
  edits: InterestEdits;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Why a story is in the feed, as a few lines for a person. */
export function whyShown(
  item: DiscoverItem,
  sources: FeedSources,
  lowered?: Lowered
): string[] {
  const reasons: string[] = [];
  const key = topicKey(item.topic);
  const same = (label: string) => topicKey(label) === key;
  const interests = sources.interests;
  const specific = interests?.specific.find(i => same(i.label));
  const general = interests?.general.find(i => same(i.label));
  const discover = interests?.discover.find(same);

  if (item.origin === 'record') {
    reasons.push(`It's new in your ${item.topic} folder.`);
  } else if (sources.manualTopics.some(same)) {
    reasons.push(`It's news on "${item.topic}", a topic you picked.`);
  } else if (sources.edits.added.some(same)) {
    reasons.push(`It's news on "${item.topic}", an interest you added.`);
  } else if (specific) {
    reasons.push(
      specific.notes === undefined
        ? `It's news on "${item.topic}", an interest read from your notes.`
        : specific.tag
          ? `It's news on "${item.topic}": ${plural(specific.notes, 'note')} of yours ${specific.notes === 1 ? 'has' : 'have'} that tag.`
          : `It's news on "${item.topic}": the words come up in ${plural(specific.notes, 'note title')} of yours.`
    );
  } else if (general) {
    const from = general.from?.slice(0, 3) ?? [];
    reasons.push(
      from.length
        ? `It's news on ${item.topic}, a broad area your interests ${from.map(f => `"${f}"`).join(', ')} belong to.`
        : `It's news on ${item.topic}, a broad area your notes touch.`
    );
  } else if (discover) {
    const near = interests?.discoverNear?.[discover];
    reasons.push(
      near
        ? `Something new: ${item.topic} sits next to ${near}, which your notes cover.`
        : `Something new: ${item.topic}, next to areas your notes cover.`
    );
  } else {
    reasons.push(`It came from the "${item.topic}" search.`);
  }

  if (item.origin !== 'record') {
    reasons.push(
      `${item.source || 'A news site'} published it${item.publishedAt ? ` ${new Date(item.publishedAt).toLocaleDateString()}` : ''}, via Google News.`
    );
  }
  if (lowered?.kind === 'like') {
    reasons.push(
      `It's lower in the list: it's like "${lowered.title}", which you marked not interesting.`
    );
  } else if (lowered?.kind === 'topic') {
    reasons.push(
      `It's lower in the list: you marked ${plural(lowered.count, 'story', 'stories')} on "${lowered.topic}" not interesting lately.`
    );
  }
  return reasons;
}

const DISMISSED_PATH = '/api/notes/discover/dismissed';
const DISMISSED_KEY = 'notesgraph:discover:dismissed';
/** The most kept, as on the server; the oldest go first. */
const MAX_DISMISSED = 500;

const asDismissals = (value: unknown): Dismissal[] =>
  Array.isArray(value)
    ? value.filter(
        (d): d is Dismissal =>
          !!d &&
          typeof d === 'object' &&
          typeof (d as Dismissal).id === 'string' &&
          typeof (d as Dismissal).at === 'number'
      )
    : [];

/** Both lists as one: one entry per story, the latest, oldest first, capped. */
export function mergeDismissals(...lists: Dismissal[][]): Dismissal[] {
  const byId = new Map<string, Dismissal>();
  for (const d of lists.flat()) {
    const seen = byId.get(d.id);
    if (!seen || seen.at < d.at) byId.set(d.id, d);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-MAX_DISMISSED);
}

/** This device's copy, for the feed before the server answers. */
export function loadDismissals(): Dismissal[] {
  try {
    return asDismissals(
      JSON.parse(globalThis.localStorage?.getItem(DISMISSED_KEY) ?? '[]')
    );
  } catch {
    return [];
  }
}

export function saveDismissals(dismissed: Dismissal[]): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // ignore (private mode / worker)
  }
}

/** The user's dismissals on the server; throws when signed out or offline. */
export async function fetchServerDismissals(
  fetch: ServerFetch
): Promise<Dismissal[]> {
  const res = await fetch(DISMISSED_PATH, { cache: 'no-store' });
  const body = (await res.json()) as { dismissed?: unknown };
  return asDismissals(body.dismissed);
}

export async function saveServerDismissals(
  fetch: ServerFetch,
  dismissed: Dismissal[]
): Promise<void> {
  await fetch(DISMISSED_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dismissed }),
  });
}
