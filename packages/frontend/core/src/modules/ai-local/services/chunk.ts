/**
 * Split text into overlapping chunks for embedding. Sliding window over
 * characters, preferring to break on paragraph/sentence boundaries so chunks
 * stay coherent. Overlap keeps context across boundaries for retrieval.
 */
export function chunkText(
  text: string,
  maxChars = 1000,
  overlap = 150
): string[] {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const paraBreak = window.lastIndexOf('\n\n');
      const sentenceBreak = window.lastIndexOf('. ');
      if (paraBreak > maxChars * 0.5) {
        end = start + paraBreak;
      } else if (sentenceBreak > maxChars * 0.5) {
        end = start + sentenceBreak + 1;
      }
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
