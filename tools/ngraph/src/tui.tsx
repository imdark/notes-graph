import { Box, render, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useEffect, useState } from 'react';

import { listNotes, viewNote } from './notes';
import type { DocMeta, Transport } from './transport';

const PAGE_SIZE = 18;

const App = ({ transport }: { transport: Transport }) => {
  const { exit } = useApp();
  const [notes, setNotes] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<{ title: string; markdown: string } | null>(
    null
  );

  useEffect(() => {
    listNotes(transport)
      .then(list => setNotes(list))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [transport]);

  const filtered = notes.filter(note =>
    note.title.toLowerCase().includes(query.toLowerCase())
  );
  const clamped = Math.min(selected, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (view) {
      if (key.escape || key.backspace || input === 'q') setView(null);
      return;
    }
    if (searching) {
      if (key.escape || key.return) setSearching(false);
      return; // TextInput handles typing
    }
    if (input === 'q') return exit();
    if ((key.ctrl && input === 'k') || input === '/') {
      setSearching(true);
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelected(Math.min(filtered.length - 1, clamped + 1));
    } else if (key.upArrow || input === 'k') {
      setSelected(Math.max(0, clamped - 1));
    } else if (key.return) {
      const note = filtered[clamped];
      if (note) {
        viewNote(transport, note.id)
          .then(v => v && setView({ title: v.title, markdown: v.markdown }))
          .catch(() => undefined);
      }
    }
  });

  if (view) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">
          {view.title}
        </Text>
        <Text> </Text>
        <Text>{view.markdown || '(empty)'}</Text>
        <Text> </Text>
        <Text dimColor>Esc/q back</Text>
      </Box>
    );
  }

  const start = Math.max(
    0,
    Math.min(clamped - PAGE_SIZE + 1, filtered.length - PAGE_SIZE)
  );
  const window = filtered.slice(start, start + PAGE_SIZE);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan">🔍 </Text>
        {searching ? (
          <TextInput
            value={query}
            onChange={setQuery}
            onSubmit={() => setSearching(false)}
          />
        ) : (
          <Text dimColor>{query || 'Ctrl+K or / to search'}</Text>
        )}
      </Box>
      <Text> </Text>
      {loading ? (
        <Text>Loading…</Text>
      ) : filtered.length === 0 ? (
        <Text dimColor>No notes match.</Text>
      ) : (
        window.map((note, i) => {
          const isSel = start + i === clamped;
          return (
            <Text key={note.id} color={isSel ? 'green' : undefined}>
              {isSel ? '❯ ' : '  '}
              {note.title || '(untitled)'}
            </Text>
          );
        })
      )}
      <Text> </Text>
      <Text dimColor>
        {filtered.length} notes · ↑/↓ move · Enter view · Ctrl+K search · q quit
      </Text>
    </Box>
  );
};

export async function runTui(transport: Transport): Promise<void> {
  const { waitUntilExit } = render(<App transport={transport} />);
  await waitUntilExit();
}
