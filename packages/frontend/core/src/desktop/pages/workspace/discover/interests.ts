import type { Memento } from '@notesgraph/infra';

/**
 * Interests read from the user's notes, used as search topics for the
 * Discover feed. Two kinds go into the search: specific interests (the user's
 * own tags and phrases that recur across note titles, e.g. "teleop", "CAN
 * bus") and general areas those belong to ("Robotics"). On top of that come a
 * few areas next to the general ones that the notes don't cover yet, so the
 * feed also surfaces new interests instead of only echoing old ones.
 */
export interface Interest {
  label: string;
  /** Higher is stronger: notes mentioning it, with recent notes counting double. */
  weight: number;
}

export interface UserInterests {
  specific: Interest[];
  general: Interest[];
  /** Areas adjacent to the general ones that the notes don't mention yet. */
  discover: string[];
  computedAt: number;
}

export interface NotesSnapshot {
  docs: { id: string; title: string; tagIds: string[]; updatedDate?: number }[];
  /** tag id -> tag name */
  tagNames: Map<string, string>;
  now?: number;
}

interface Area {
  label: string;
  keywords: string[];
  related: string[];
}

/**
 * General areas, matched by keyword against the specific interests. `related`
 * are the areas offered for discovery once an area shows up in the notes.
 */
const AREAS: Area[] = [
  {
    label: 'Artificial intelligence',
    keywords: [
      'ai',
      'llm',
      'gpt',
      'claude',
      'agent',
      'agents',
      'model',
      'models',
      'prompt',
      'prompts',
      'embedding',
      'embeddings',
      'rag',
      'machine learning',
      'neural',
      'inference',
    ],
    related: ['Robotics', 'Cognitive science', 'Software engineering'],
  },
  {
    label: 'Robotics',
    keywords: [
      'robot',
      'robots',
      'robotics',
      'ros',
      'teleop',
      'teleoperation',
      'jetson',
      'servo',
      'motor',
      'motors',
      'can bus',
      'actuator',
      'lidar',
      'drone',
      'drones',
    ],
    related: ['Embedded systems', 'Artificial intelligence', 'Manufacturing'],
  },
  {
    label: 'Embedded systems',
    keywords: [
      'embedded',
      'firmware',
      'arduino',
      'raspberry',
      'microcontroller',
      'gpio',
      'pcb',
      'fpga',
      'esp32',
      'sensor',
      'sensors',
    ],
    related: ['Robotics', 'Electronics'],
  },
  {
    label: 'Electronics',
    keywords: [
      'electronics',
      'circuit',
      'soldering',
      'voltage',
      'battery',
      'batteries',
    ],
    related: ['Embedded systems', 'Energy'],
  },
  {
    label: 'Software engineering',
    keywords: [
      'code',
      'coding',
      'programming',
      'typescript',
      'javascript',
      'python',
      'rust',
      'react',
      'api',
      'backend',
      'frontend',
      'database',
      'git',
      'deploy',
      'refactor',
      'testing',
      'devops',
      'kubernetes',
      'docker',
    ],
    related: ['Developer tools', 'Open source', 'Artificial intelligence'],
  },
  {
    label: 'Developer tools',
    keywords: [
      'cli',
      'editor',
      'vim',
      'ide',
      'terminal',
      'workflow',
      'automation',
      'plugin',
      'plugins',
    ],
    related: ['Software engineering', 'Productivity'],
  },
  {
    label: 'Productivity',
    keywords: [
      'productivity',
      'notes',
      'note taking',
      'todo',
      'habits',
      'habit',
      'planning',
      'journal',
      'journaling',
      'focus',
      'gtd',
      'zettelkasten',
    ],
    related: ['Personal knowledge management', 'Psychology'],
  },
  {
    label: 'Personal knowledge management',
    keywords: [
      'knowledge',
      'graph',
      'backlinks',
      'second brain',
      'obsidian',
      'logseq',
      'wiki',
    ],
    related: ['Productivity', 'Cognitive science'],
  },
  {
    label: 'Startups',
    keywords: [
      'startup',
      'startups',
      'founder',
      'fundraising',
      'pitch',
      'investors',
      'product',
      'launch',
      'pricing',
      'growth',
      'marketing',
      'saas',
    ],
    related: ['Business strategy', 'Design'],
  },
  {
    label: 'Business strategy',
    keywords: [
      'business',
      'strategy',
      'market',
      'sales',
      'customers',
      'revenue',
    ],
    related: ['Startups', 'Economics'],
  },
  {
    label: 'Design',
    keywords: [
      'design',
      'ui',
      'ux',
      'typography',
      'figma',
      'layout',
      'accessibility',
    ],
    related: ['Psychology', 'Software engineering'],
  },
  {
    label: 'Health and fitness',
    keywords: [
      'health',
      'fitness',
      'workout',
      'running',
      'sleep',
      'diet',
      'nutrition',
      'exercise',
      'gym',
      'yoga',
    ],
    related: ['Psychology', 'Cooking'],
  },
  {
    label: 'Cooking',
    keywords: [
      'recipe',
      'recipes',
      'cooking',
      'baking',
      'food',
      'meal',
      'meals',
    ],
    related: ['Health and fitness', 'Travel'],
  },
  {
    label: 'Travel',
    keywords: ['travel', 'trip', 'flight', 'hotel', 'vacation', 'itinerary'],
    related: ['Cooking', 'History'],
  },
  {
    label: 'Personal finance',
    keywords: [
      'finance',
      'budget',
      'investing',
      'stocks',
      'tax',
      'taxes',
      'savings',
      'mortgage',
    ],
    related: ['Economics', 'Business strategy'],
  },
  {
    label: 'Economics',
    keywords: ['economics', 'economy', 'inflation'],
    related: ['Personal finance', 'History'],
  },
  {
    label: 'Psychology',
    keywords: [
      'psychology',
      'motivation',
      'emotions',
      'therapy',
      'mindfulness',
      'meditation',
    ],
    related: ['Cognitive science', 'Health and fitness'],
  },
  {
    label: 'Parenting',
    keywords: ['parenting', 'kids', 'children', 'school', 'baby'],
    related: ['Psychology', 'Education'],
  },
  {
    label: 'Education',
    keywords: [
      'learning',
      'course',
      'courses',
      'teaching',
      'study',
      'education',
    ],
    related: ['Cognitive science', 'Parenting'],
  },
  {
    label: 'Books',
    keywords: ['book', 'books', 'reading', 'novel', 'fiction'],
    related: ['History', 'Psychology'],
  },
  {
    label: 'Music',
    keywords: ['music', 'guitar', 'piano', 'song', 'songs', 'album'],
    related: ['Books', 'Design'],
  },
];

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have how i in into is it its me my of on or our so the this that to was we what when where which who why will with you your ' +
    'untitled new note notes doc docs page draft copy todo list ideas idea task tasks meeting meetings misc stuff things thing more about using use get make vs ' +
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday week weekly daily'
  ).split(' ')
);

/** A doc counts double when it was edited in the last 30 days. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_SPECIFIC = 12;
const MAX_GENERAL = 5;
const MAX_DISCOVER = 3;

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(
      w => w.length >= 2 && !STOPWORDS.has(w) && !/\d/.test(w) && w !== '#'
    );
}

function titleCase(phrase: string): string {
  return phrase.replace(/\b\p{L}/gu, c => c.toUpperCase());
}

/**
 * Derive the user's interests from note titles and tags. Pure: the caller
 * supplies a snapshot of the workspace, so this is easy to test and cheap to
 * re-run.
 */
export function deriveInterests(snapshot: NotesSnapshot): UserInterests {
  const now = snapshot.now ?? Date.now();
  const scores = new Map<
    string,
    { label: string; weight: number; docs: number }
  >();

  const bump = (key: string, label: string, weight: number) => {
    const entry = scores.get(key);
    if (entry) {
      entry.weight += weight;
      entry.docs += 1;
    } else {
      scores.set(key, { label, weight, docs: 1 });
    }
  };

  const tagKeys = new Set<string>();
  for (const doc of snapshot.docs) {
    const docWeight =
      doc.updatedDate && now - doc.updatedDate < RECENT_MS ? 2 : 1;

    // Tags are an explicit statement of interest: weigh them above words.
    for (const tagId of new Set(doc.tagIds)) {
      const name = snapshot.tagNames.get(tagId)?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      tagKeys.add(key);
      bump(key, name, docWeight * 2);
    }

    // Words and two-word phrases from the title, each counted once per doc.
    const words = tokenize(doc.title);
    const seen = new Set<string>();
    for (let i = 0; i < words.length; i++) {
      seen.add(words[i]);
      if (i + 1 < words.length) seen.add(`${words[i]} ${words[i + 1]}`);
    }
    for (const term of seen) bump(term, term, docWeight);
  }

  // A title word is only an interest once it recurs across notes; a tag is one
  // as soon as it is used.
  const candidates = [...scores.entries()]
    .filter(([key, s]) => tagKeys.has(key) || s.docs >= 2)
    .sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]));

  // A word always scores at least as high as any phrase containing it, so let
  // the phrase stand in for the word when it carries most of its weight
  // ("can bus" rather than "can"). Then skip anything overlapping a pick.
  const phrases = candidates.filter(([key]) => key.includes(' '));
  const dominated = new Set(
    candidates
      .filter(
        ([key, s]) =>
          !key.includes(' ') &&
          !tagKeys.has(key) &&
          phrases.some(
            ([p, ps]) =>
              p.split(' ').includes(key) && ps.weight >= s.weight * 0.6
          )
      )
      .map(([key]) => key)
  );
  const specific: Interest[] = [];
  const picked: string[] = [];
  for (const [key, s] of candidates) {
    if (specific.length >= MAX_SPECIFIC) break;
    if (dominated.has(key)) continue;
    const overlaps = picked.some(
      p =>
        (p.includes(' ') && p.split(' ').includes(key)) ||
        (key.includes(' ') && key.split(' ').includes(p))
    );
    if (overlaps) continue;
    picked.push(key);
    specific.push({
      label: tagKeys.has(key) ? s.label : titleCase(s.label),
      weight: s.weight,
    });
  }

  // General areas: sum the weight of every specific interest that names one
  // of the area's keywords.
  const areaWeights = new Map<string, number>();
  for (const interest of specific) {
    const key = interest.label.toLowerCase();
    const words = new Set(key.split(/\s+/));
    for (const area of AREAS) {
      const hit =
        area.keywords.some(k =>
          k.includes(' ') ? key.includes(k) : words.has(k)
        ) || key === area.label.toLowerCase();
      if (hit) {
        areaWeights.set(
          area.label,
          (areaWeights.get(area.label) ?? 0) + interest.weight
        );
      }
    }
  }
  const general: Interest[] = [...areaWeights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_GENERAL)
    .map(([label, weight]) => ({ label, weight }));

  // Discovery: areas next to the strongest general ones, not already covered.
  const covered = new Set(
    [...general, ...specific].map(i => i.label.toLowerCase())
  );
  const discover: string[] = [];
  for (const g of general) {
    const area = AREAS.find(a => a.label === g.label);
    for (const rel of area?.related ?? []) {
      if (discover.length >= MAX_DISCOVER) break;
      if (!covered.has(rel.toLowerCase()) && !discover.includes(rel)) {
        discover.push(rel);
      }
    }
  }

  return { specific, general, discover, computedAt: now };
}

/** How many of each kind go into the feed's search. */
const SEARCH_SPECIFIC = 6;
const SEARCH_GENERAL = 3;

/**
 * The topics to search for: the strongest specific interests, then the general
 * areas, then the discovery areas. De-duplicated, case-insensitively, against
 * the user's own manual topics.
 */
export function interestSearchTopics(
  interests: UserInterests,
  manual: string[] = []
): string[] {
  const out: string[] = [];
  const seen = new Set(manual.map(t => t.toLowerCase()));
  const add = (t: string) => {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  };
  interests.specific.slice(0, SEARCH_SPECIFIC).forEach(i => add(i.label));
  interests.general.slice(0, SEARCH_GENERAL).forEach(i => add(i.label));
  interests.discover.forEach(add);
  return out;
}

const INTERESTS_PREFIX = 'discover:interests:v1:';
/** Re-read the notes for interests at most once a day, like the feed itself. */
export const INTERESTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadInterests(
  cache: Memento,
  workspaceId: string
): UserInterests | null {
  const value = cache.get<UserInterests>(INTERESTS_PREFIX + workspaceId);
  if (
    value &&
    Array.isArray(value.specific) &&
    Array.isArray(value.general) &&
    Array.isArray(value.discover) &&
    typeof value.computedAt === 'number'
  ) {
    return value;
  }
  return null;
}

export function saveInterests(
  cache: Memento,
  workspaceId: string,
  interests: UserInterests
): void {
  cache.set<UserInterests>(INTERESTS_PREFIX + workspaceId, interests);
}

const USE_INTERESTS_KEY = 'notesgraph:discover:use-interests';

/** Whether the feed also searches the interests read from notes (on by default). */
export function loadUseInterests(): boolean {
  try {
    return globalThis.localStorage?.getItem(USE_INTERESTS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveUseInterests(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(USE_INTERESTS_KEY, String(value));
  } catch {
    // ignore (private mode / worker)
  }
}
