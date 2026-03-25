export type TextChunk = {
  startLine: number;
  endLine: number;
  content: string;
};

// MVP: chunk by fixed line count to keep boundaries predictable for tooling.
export function chunkTextByLines(text: string, linesPerChunk: number): TextChunk[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const chunks: TextChunk[] = [];

  // Use 1-based line numbers (human-friendly and matches doc examples).
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const startLine = i + 1;
    const endLine = Math.min(i + linesPerChunk, lines.length);
    const content = lines.slice(i, endLine).join('\n').trimEnd();
    if (content.length === 0) continue;
    chunks.push({ startLine, endLine, content });
  }

  return chunks;
}

