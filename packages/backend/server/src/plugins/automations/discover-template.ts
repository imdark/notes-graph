/**
 * The daily Discover preseed, as an automation. Discover reads each topic's
 * news from the link-card sidecar's shared feed (`/clip/news-feed`) and each
 * story's picture from `/clip/news-image`, both cached there for every
 * client. This pulls today's feed for each topic in the morning and resolves
 * the pictures, so the first visit of the day finds both ready.
 *
 * Tested by running it under node against a fake `notesgraph` and sidecar
 * (__tests__/discover-template.spec.ts). Keep the code free of template
 * literals and backticks: it is embedded in String.raw below.
 */
export const PRESEED_DISCOVER_TEMPLATE = String.raw`// Every morning, pull today's news for each Discover topic onto the
// link-card sidecar and resolve each story's picture, so Discover opens
// with the day's feed and its images already there.
// The topics are the ones picked on the Discover page (TOPICS below until a
// selection is saved) plus any listed one per line in a note titled
// "Discover topics". CLIP_URL is where this device reaches the app's /clip/*.
const CLIP_URL = 'https://app.notesgraph.com';
const TOPICS = ['Technology', 'Artificial intelligence', 'Science'];
const TOPICS_NOTE = 'Discover topics';
const IMAGES_PER_TOPIC = 30;
// The sidecar decodes Google News links two at a time; more only queue.
const CONCURRENCY = 2;
const ws = notesgraph.workspaceId;

async function clip(path) {
  const res = await fetch(CLIP_URL + path);
  if (!res.ok) throw new Error(path.split('?')[0] + ' answered ' + res.status);
  return res.json();
}

const topics = [];
const seen = new Set();
function addTopic(raw) {
  const topic = String(raw).trim();
  const key = topic.toLowerCase();
  if (!topic || seen.has(key)) return;
  seen.add(key);
  topics.push(topic);
}
const picked = await notesgraph.fetch('/api/notes/discover/topics');
(Array.isArray(picked.topics) ? picked.topics : TOPICS).forEach(addTopic);

const { docs } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs?q=' + encodeURIComponent(TOPICS_NOTE) + '&limit=20');
const note = docs.find(d => d.title.trim().toLowerCase() === TOPICS_NOTE.toLowerCase());
if (note) {
  const { markdown } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(note.docId) + '/markdown');
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const topic = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim();
    // a sentence is prose about the topics, not one
    if (topic.length <= 60 && !/[.!?]$/.test(topic)) addTopic(topic);
  }
}
console.log(topics.length + ' topics: ' + topics.join(', '));

const report = [];
for (const topic of topics) {
  let feed;
  try {
    feed = await clip('/clip/news-feed?refresh=1&topic=' + encodeURIComponent(topic));
  } catch (err) {
    console.log(topic + ': feed failed, ' + err.message);
    report.push({ topic, error: err.message });
    continue;
  }
  const newest = feed.items
    .slice()
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, IMAGES_PER_TOPIC);
  const missing = newest.filter(item => !item.image);
  let images = newest.length - missing.length;
  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const item = missing[next++];
      try {
        const { image } = await clip(
          '/clip/news-image?title=' + encodeURIComponent(item.title) +
            '&source=' + encodeURIComponent(item.source || '') +
            '&url=' + encodeURIComponent(item.link)
        );
        if (image) images++;
      } catch (err) {
        console.log(topic + ': no image for "' + item.title + '", ' + err.message);
      }
    }
  }
  await Promise.all([...Array(CONCURRENCY)].map(worker));
  console.log(topic + ': ' + feed.items.length + ' stories, ' + images + ' of the newest ' + newest.length + ' with a picture');
  report.push({ topic, stories: feed.items.length, images, checked: newest.length });
}

const failed = report.filter(r => r.error).length;
if (failed === topics.length && topics.length) throw new Error('no topic could be pulled');
const summary =
  report.length - failed + ' of ' + topics.length + ' topics preseeded, ' +
  report.reduce((n, r) => n + (r.images || 0), 0) + ' pictures ready';
console.log(summary);
return { summary, topics: report };
`;

export const DISCOVER_TEMPLATES = [
  {
    id: 'preseed-discover',
    name: 'Preseed the Discover feed every morning',
    description:
      "Every day at 5am (Pacific), pull the day's news for each Discover topic and resolve each story's picture, so Discover opens with today's feed and its images ready. Topics are the ones picked on the Discover page, plus any listed in a \"Discover topics\" note.",
    triggers: [{ type: 'cron', expr: '0 5 * * *', tz: 'America/Los_Angeles' }],
    code: PRESEED_DISCOVER_TEMPLATE,
    timeoutSeconds: 20 * 60,
  },
];
