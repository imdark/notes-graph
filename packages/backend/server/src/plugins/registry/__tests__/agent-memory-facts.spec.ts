import test from 'ava';

import {
  applyMemoryOps,
  extractionContent,
  factKey,
  groupByDomain,
  groupBySubject,
  lessonsSection,
  linkedDocIds,
  type MemoryFact,
  newLessonNote,
  parseExtraction,
  parseFacts,
  parseLessons,
  recallFacts,
  recallLessons,
  recallSection,
} from '../agent-memory-facts';

const today = '2026-10-14';

test('a subject note reads as its fact lines', t => {
  const markdown = [
    '# About Cosmo',
    '',
    "- Cosmo: the user's son, 7 years old (as of 2026-10-02).",
    '* Likes dinosaurs',
    '1. [ ] Allergic to peanuts',
    '[Family](/workspace/ws/doc-family)',
    '---',
    '> Edited via MCP by claude — 2026-10-02 10:00',
  ].join('\n');
  t.deepEqual(parseFacts('Cosmo', markdown), [
    {
      subject: 'Cosmo',
      text: "Cosmo: the user's son, 7 years old (as of 2026-10-02).",
      date: '2026-10-02',
    },
    { subject: 'Cosmo', text: 'Likes dinosaurs', date: null },
    { subject: 'Cosmo', text: 'Allergic to peanuts', date: null },
  ]);
});

test('two wordings of a fact share a key', t => {
  t.is(
    factKey("- Cosmo: the user's **son** (as of 2026-10-02).", 'Cosmo'),
    factKey("the user's son", 'Cosmo')
  );
  t.not(factKey('likes cats'), factKey('likes dogs'));
});

test('links under the memory note are found in either form', t => {
  const markdown =
    '[Cosmo](/workspace/ws-1/doc-a) and [](LinkedPage:doc_b)\n' +
    '[again](/workspace/ws-1/doc-a) [self](/workspace/ws-1/root)';
  t.deepEqual(linkedDocIds(markdown, 'root'), ['doc-a', 'doc_b']);
});

test('extraction output is cleaned and capped', t => {
  const ops = parseExtraction({
    create: [
      { subject: '  Cosmo ', fact: 'Likes\n dinosaurs' },
      { subject: '', fact: 'no subject' },
      { subject: 'Agent memory', fact: 'filed under the root' },
      'nonsense',
      ...Array.from({ length: 30 }, (_, i) => ({
        subject: 'X',
        fact: `f${i}`,
      })),
    ],
    delete: null,
  });
  t.deepEqual(ops.create[0], { subject: 'Cosmo', fact: 'Likes dinosaurs' });
  t.is(ops.create.length, 20);
  t.deepEqual(ops.delete, []);
  t.deepEqual(parseExtraction(undefined), {
    create: [],
    delete: [],
    lessons: [],
  });
});

test('ops group by subject regardless of case', t => {
  const groups = groupBySubject({
    create: [
      { subject: 'cosmo', fact: 'b' },
      { subject: 'Diet', fact: 'c' },
    ],
    delete: [{ subject: 'Cosmo', fact: 'a' }],
  });
  t.deepEqual([...groups.keys()], ['cosmo', 'diet']);
  t.deepEqual(groups.get('cosmo'), {
    subject: 'Cosmo',
    create: ['b'],
    delete: ['a'],
  });
});

test('new facts are appended dated, below the list and above the stamp', t => {
  const markdown = [
    'Intro paragraph.',
    '',
    "- Cosmo: the user's son, 7 years old (as of 2026-10-02).",
    '',
    '> Edited via MCP by claude — 2026-10-02 10:00',
    '',
  ].join('\n');
  const result = applyMemoryOps(
    markdown,
    'Cosmo',
    { create: ['Likes dinosaurs.', "the user's son, 7 years old"], delete: [] },
    today
  );
  t.is(result.created, 1);
  t.is(
    result.markdown,
    [
      'Intro paragraph.',
      '',
      "- Cosmo: the user's son, 7 years old (as of 2026-10-02).",
      `- Likes dinosaurs (as of ${today})`,
      '',
      '> Edited via MCP by claude — 2026-10-02 10:00',
      '',
    ].join('\n')
  );
});

test('a delete removes the fact however it was worded; an update replaces it', t => {
  const markdown =
    "- Cosmo: the user's son, 7 years old (as of 2025-10-02).\n- Likes dinosaurs\n";
  const result = applyMemoryOps(
    markdown,
    'Cosmo',
    {
      delete: ["the user's son, 7 years old"],
      create: ["Cosmo is the user's son, 8 years old."],
    },
    today
  );
  t.is(result.deleted, 1);
  t.is(result.created, 1);
  t.is(
    result.markdown,
    `- Likes dinosaurs\n- Cosmo is the user's son, 8 years old (as of ${today})\n`
  );
});

test('nothing to change leaves the note as it is', t => {
  const markdown = '- Likes dinosaurs\n';
  const result = applyMemoryOps(
    markdown,
    'Cosmo',
    { create: ['likes dinosaurs'], delete: ['not there'] },
    today
  );
  t.deepEqual(result, { markdown, created: 0, deleted: 0 });
});

test('a new note starts with its facts', t => {
  const result = applyMemoryOps(
    '',
    'Diet',
    { create: ['Vegetarian'], delete: [] },
    today
  );
  t.is(result.markdown, `- Vegetarian (as of ${today})\n`);
});

const facts: MemoryFact[] = [
  {
    subject: 'Cosmo',
    text: "Cosmo is the user's son, 7 years old",
    date: '2026-01-01',
  },
  { subject: 'Diet', text: 'The user is vegetarian', date: '2026-09-01' },
  { subject: 'Home', text: 'Lives in Lisbon', date: '2026-08-01' },
  { subject: 'Work', text: 'Works on NotesGraph', date: null },
];

test('recall puts facts the task mentions first, then the most recent', t => {
  const picked = recallFacts(facts, 'Find a show to watch with Cosmo', {
    max: 3,
  });
  t.deepEqual(
    picked.map(f => f.subject),
    ['Cosmo', 'Diet', 'Home']
  );
});

test('recall stays within its character budget', t => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    subject: 'Topic',
    text: `fact number ${i} ${'x'.repeat(80)}`,
    date: null,
  }));
  const picked = recallFacts(many, 'anything', { max: 50, maxChars: 500 });
  t.true(picked.length > 0);
  t.true(recallSection(picked).length < 800);
});

test('the recall section names each fact once, with its subject', t => {
  t.is(recallSection([]), '');
  const section = recallSection(facts.slice(0, 2));
  t.true(section.includes("- Cosmo is the user's son, 7 years old"));
  t.true(section.includes('- Diet: The user is vegetarian'));
});

test('the extraction reads the end of a long transcript', t => {
  const content = extractionContent({
    today,
    instructions: 'Pick a show',
    title: 'Show for Cosmo',
    questions: [{ text: 'How old is Cosmo?', answer: '7' }],
    result: 'Bluey',
    log: `${'a'.repeat(20_000)}THE END`,
    facts,
  });
  t.true(content.includes('Q: How old is Cosmo?\nA: 7'));
  t.true(content.includes('THE END'));
  t.true(content.length < 20_000);
});

const tripNote = [
  'Applies to: travel, **vacation**; flight',
  '',
  '- Bring toys and games for Cosmo (as of 2026-11-07)',
  '- [ ] Plan a physical activity for each day',
  '[Family](/workspace/ws/doc-family)',
  '> Edited via MCP by claude — 2026-11-07 10:00',
].join('\n');

test('a lesson note reads as its triggers and its lessons', t => {
  const note = parseLessons('Trip planning', tripNote);
  t.deepEqual(note.triggers, ['Trip planning', 'travel', 'vacation', 'flight']);
  t.deepEqual(note.lessons, [
    {
      subject: 'Trip planning',
      text: 'Bring toys and games for Cosmo (as of 2026-11-07)',
      date: '2026-11-07',
    },
    {
      subject: 'Trip planning',
      text: 'Plan a physical activity for each day',
      date: null,
    },
  ]);
});

const lessonNotes = [
  parseLessons('Trip planning', tripNote),
  parseLessons('Grocery shopping', '- Buy oat milk, not cow milk\n'),
  parseLessons('Empty', 'Applies to: anything\n'),
];

test('a task recalls the notes for its kind, with every lesson', t => {
  const picked = recallLessons(lessonNotes, 'Plan our trips to Kyoto in May');
  t.deepEqual(
    picked.map(n => n.domain),
    ['Trip planning']
  );
  t.is(picked[0].lessons.length, 2);
  t.deepEqual(
    recallLessons(lessonNotes, 'Book a flight for the conference').map(
      n => n.domain
    ),
    ['Trip planning']
  );
  // One word of a two-word title is not enough, and a note with no lessons
  // is never recalled.
  t.deepEqual(recallLessons(lessonNotes, 'Plan the sprint'), []);
  t.deepEqual(recallLessons(lessonNotes, 'anything at all'), []);
});

test('lesson recall stays within its character budget', t => {
  const long = parseLessons(
    'Trip planning',
    Array.from(
      { length: 50 },
      (_, i) => `- lesson ${i} ${'x'.repeat(60)}`
    ).join('\n')
  );
  const [picked] = recallLessons([long], 'trip planning', { maxChars: 500 });
  t.true(picked.lessons.length > 0 && picked.lessons.length < 50);
  t.true(lessonsSection([picked]).length < 900);
});

test('the lessons section lists each domain with its lessons', t => {
  t.is(lessonsSection([]), '');
  const section = lessonsSection(recallLessons(lessonNotes, 'vacation ideas'));
  t.true(section.includes('"Agent lessons"'));
  t.true(
    section.includes(
      'Trip planning:\n- Bring toys and games for Cosmo (as of 2026-11-07)\n- Plan'
    )
  );
});

test('lesson ops are cleaned, capped and grouped by domain', t => {
  const { lessons } = parseExtraction({
    lessons: [
      { domain: ' Trip planning ', lesson: 'Pack\n snacks', appliesTo: 'trip' },
      { domain: 'trip planning', lesson: 'Book seats together' },
      { domain: 'Agent lessons', lesson: 'filed under the root' },
      { domain: 'Trip planning', lesson: '' },
      ...Array.from({ length: 20 }, (_, i) => ({
        domain: 'X',
        lesson: `l${i}`,
      })),
    ],
  });
  t.deepEqual(lessons[0], {
    domain: 'Trip planning',
    lesson: 'Pack snacks',
    appliesTo: 'trip',
  });
  t.is(lessons.length, 10);
  const groups = groupByDomain(lessons);
  t.deepEqual(groups.get('trip planning'), {
    domain: 'Trip planning',
    appliesTo: 'trip',
    lessons: ['Pack snacks', 'Book seats together'],
  });
});

test('a new lesson note starts with its Applies to line', t => {
  t.is(
    newLessonNote(' trip, travel ;; vacation '),
    'Applies to: trip, travel, vacation\n'
  );
  t.is(newLessonNote(''), '');
});

test('the extraction is shown the lessons already kept', t => {
  const content = extractionContent({
    today,
    instructions: 'Plan a trip',
    title: null,
    questions: [],
    result: null,
    log: '',
    facts: [],
    lessons: lessonNotes,
  });
  t.true(
    content.includes(
      '## Lessons already kept\nTrip planning (applies to: Trip planning, travel, vacation, flight):'
    )
  );
});
