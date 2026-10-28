// Reads the feature flags in the app's flag list (NOTESGRAPH_FLAGS) as text,
// for the scripts that stamp each flag with the commit that added it and
// record which of them a deploy carries.
export const FLAGS_FILE =
  'packages/frontend/core/src/modules/feature-flag/constant.ts';

/**
 * Each flag's key, the commit stamped on it (null if none yet), and the line
 * its entry opens on. An entry is `  key: {` up to its closing `  },`.
 */
export function readFlags(text) {
  const lines = text.split('\n');
  const flags = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {2}(\w+): \{$/.exec(lines[i]);
    if (!open) continue;
    let commit = null;
    for (let j = i + 1; j < lines.length && !/^ {2}\},?$/.test(lines[j]); j++) {
      const stamp = /^ {4}commit: '([0-9a-f]*)',$/.exec(lines[j]);
      if (stamp) commit = stamp[1] || null;
    }
    flags.push({ key: open[1], commit, line: i });
  }
  return flags;
}
