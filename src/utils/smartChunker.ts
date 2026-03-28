/**
 * AST-heuristic chunker: splits code at semantic boundaries (function/class/block)
 * based on language-specific patterns. Falls back to line-based chunking for
 * unknown languages or when heuristic detection fails.
 *
 * Zero external dependencies -- uses regex patterns per language.
 * Upgradeable to tree-sitter later for higher accuracy.
 */

import { type TextChunk } from './chunker.js';

export type SmartChunk = TextChunk & {
  symbolName?: string;
  symbolType?: string;
};

type BoundaryPattern = {
  /** Regex to detect the start of a top-level declaration. */
  pattern: RegExp;
  /** Extract symbol name from the match. */
  nameExtractor: (match: RegExpMatchArray) => string;
  /** Type of symbol (function, class, interface, etc.). */
  symbolType: string;
};

// --- Language-specific boundary patterns ---

const TS_JS_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:export\s+)?interface\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
  { pattern: /^(?:export\s+)?type\s+(\w+)\s*[=<]/,
    nameExtractor: m => m[1]!, symbolType: 'type' },
  { pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^(?:export\s+)?enum\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'enum' },
];

const PYTHON_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:async\s+)?def\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  // Module-level decorated function/class
  { pattern: /^@\w+(?:\.\w+)*(?:\([^)]*\))?\s*$/,
    nameExtractor: () => '', symbolType: 'decorator' },
];

const GO_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/,
    nameExtractor: m => `${m[2]}.${m[3]}`, symbolType: 'method' },
  { pattern: /^func\s+(\w+)\s*\(/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^type\s+(\w+)\s+struct\b/,
    nameExtractor: m => m[1]!, symbolType: 'struct' },
  { pattern: /^type\s+(\w+)\s+interface\b/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
];

const RUST_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^(?:pub(?:\([\w:]+\))?\s+)?struct\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'struct' },
  { pattern: /^(?:pub(?:\([\w:]+\))?\s+)?enum\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'enum' },
  { pattern: /^(?:pub(?:\([\w:]+\))?\s+)?trait\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'trait' },
  { pattern: /^impl(?:<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)/,
    nameExtractor: m => m[1] ? `${m[1]} for ${m[2]}` : m[2]!, symbolType: 'impl' },
];

const JAVA_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:public|private|protected)?\s*interface\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
  { pattern: /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:synchronized\s+)?\w+(?:<[^>]+>)?\s+(\w+)\s*\(/,
    nameExtractor: m => m[1]!, symbolType: 'method' },
];

const CSHARP_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:partial\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:public|private|protected|internal)?\s*interface\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
  { pattern: /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:override\s+)?\w+(?:<[^>]+>)?\s+(\w+)\s*\(/,
    nameExtractor: m => m[1]!, symbolType: 'method' },
];

const RUBY_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^module\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'module' },
  { pattern: /^def\s+(?:self\.)?(\w+[?!]?)/,
    nameExtractor: m => m[1]!, symbolType: 'method' },
];

const PHP_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:abstract\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^interface\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
  { pattern: /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
];

const KOTLIN_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:data\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:fun|suspend\s+fun)\s+(?:<[^>]+>\s+)?(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^interface\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'interface' },
  { pattern: /^object\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'object' },
];

const SWIFT_BOUNDARIES: BoundaryPattern[] = [
  { pattern: /^(?:public\s+|private\s+|internal\s+|open\s+)?class\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'class' },
  { pattern: /^(?:public\s+|private\s+|internal\s+)?struct\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'struct' },
  { pattern: /^(?:public\s+|private\s+|internal\s+)?func\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'function' },
  { pattern: /^(?:public\s+|private\s+|internal\s+)?protocol\s+(\w+)/,
    nameExtractor: m => m[1]!, symbolType: 'protocol' },
];

const LANGUAGE_BOUNDARIES: Record<string, BoundaryPattern[]> = {
  typescript: TS_JS_BOUNDARIES,
  javascript: TS_JS_BOUNDARIES,
  python: PYTHON_BOUNDARIES,
  go: GO_BOUNDARIES,
  rust: RUST_BOUNDARIES,
  java: JAVA_BOUNDARIES,
  csharp: CSHARP_BOUNDARIES,
  ruby: RUBY_BOUNDARIES,
  php: PHP_BOUNDARIES,
  kotlin: KOTLIN_BOUNDARIES,
  swift: SWIFT_BOUNDARIES,
};

type DetectedBoundary = {
  lineIndex: number; // 0-based
  symbolName: string;
  symbolType: string;
};

/**
 * Detect declaration boundaries in source code lines.
 * Only matches at indentation level 0 (top-level declarations) to avoid
 * splitting on nested functions/classes.
 */
function detectBoundaries(lines: string[], language: string): DetectedBoundary[] {
  const patterns = LANGUAGE_BOUNDARIES[language];
  if (!patterns) return [];

  const boundaries: DetectedBoundary[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Only match top-level declarations (no leading whitespace, or Python-style unindented).
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // For most languages, top-level means indent === 0.
    // For Python, allow indent === 0 only.
    if (indent > 0 && language !== 'php') continue;
    // PHP: allow small indent for class methods (typically 4 spaces)
    if (language === 'php' && indent > 4) continue;

    for (const bp of patterns) {
      const match = trimmed.match(bp.pattern);
      if (match) {
        const name = bp.nameExtractor(match);
        if (name || bp.symbolType === 'decorator') {
          boundaries.push({ lineIndex: i, symbolName: name, symbolType: bp.symbolType });
        }
        break; // first match wins for this line
      }
    }
  }

  return boundaries;
}

/**
 * Smart chunking: split code at semantic boundaries when possible.
 *
 * Strategy:
 * 1. Detect top-level symbol boundaries for the given language.
 * 2. Each symbol becomes a chunk (with optional merging of small symbols).
 * 3. If a symbol is too large (> maxLines), split it with line-based fallback.
 * 4. If no boundaries found, fall back entirely to line-based chunking.
 *
 * @param text       - The source code text.
 * @param language   - Detected language (lowercase).
 * @param maxLines   - Maximum lines per chunk (default 150).
 * @param minLines   - Minimum lines to keep a chunk standalone (default 5).
 */
export function smartChunkCode(
  text: string,
  language: string,
  maxLines: number = 150,
  minLines: number = 5,
): SmartChunk[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0) return [];

  const boundaries = detectBoundaries(lines, language);

  // Fallback: if no boundaries detected, use simple line-based chunking.
  if (boundaries.length === 0) {
    return lineBasedChunks(lines, maxLines);
  }

  const chunks: SmartChunk[] = [];

  // If there's content before the first boundary (imports, comments, etc.),
  // create a preamble chunk.
  if (boundaries[0]!.lineIndex > 0) {
    const preambleEnd = boundaries[0]!.lineIndex;
    const content = lines.slice(0, preambleEnd).join('\n').trimEnd();
    if (content.length > 0) {
      // If preamble is tiny, we'll merge it with the first symbol later.
      if (preambleEnd >= minLines) {
        chunks.push({
          startLine: 1,
          endLine: preambleEnd,
          content,
          symbolType: 'preamble',
        });
      }
    }
  }

  // Process each boundary region.
  for (let bi = 0; bi < boundaries.length; bi++) {
    const current = boundaries[bi]!;
    const nextStart = bi + 1 < boundaries.length ? boundaries[bi + 1]!.lineIndex : lines.length;

    // Adjust start: if there was no preamble chunk and this is the first boundary,
    // include any leading content.
    const regionStart = bi === 0 && chunks.length === 0 ? 0 : current.lineIndex;
    const regionEnd = nextStart;
    const regionLines = lines.slice(regionStart, regionEnd);
    const regionContent = regionLines.join('\n').trimEnd();

    if (regionContent.length === 0) continue;

    const lineCount = regionEnd - regionStart;

    if (lineCount <= maxLines) {
      // Fits in one chunk.
      chunks.push({
        startLine: regionStart + 1,
        endLine: regionEnd,
        content: regionContent,
        symbolName: current.symbolName || undefined,
        symbolType: current.symbolType,
      });
    } else {
      // Too large -- split with line-based fallback but keep the first chunk's metadata.
      const subChunks = lineBasedChunks(regionLines, maxLines, regionStart);
      for (let si = 0; si < subChunks.length; si++) {
        chunks.push({
          ...subChunks[si]!,
          symbolName: si === 0 ? (current.symbolName || undefined) : undefined,
          symbolType: si === 0 ? current.symbolType : undefined,
        });
      }
    }
  }

  // Merge tiny trailing chunks into their predecessor.
  return mergeSmallChunks(chunks, minLines, lines);
}

function lineBasedChunks(lines: string[], maxLines: number, offsetLineIndex: number = 0): SmartChunk[] {
  const chunks: SmartChunk[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    const end = Math.min(i + maxLines, lines.length);
    const content = lines.slice(i, end).join('\n').trimEnd();
    if (content.length === 0) continue;
    chunks.push({
      startLine: offsetLineIndex + i + 1,
      endLine: offsetLineIndex + end,
      content,
    });
  }
  return chunks;
}

function mergeSmallChunks(chunks: SmartChunk[], minLines: number, _allLines: string[]): SmartChunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: SmartChunk[] = [];
  for (const chunk of chunks) {
    const lineCount = chunk.endLine - chunk.startLine + 1;
    if (lineCount < minLines && merged.length > 0) {
      // Merge into previous chunk.
      const prev = merged[merged.length - 1]!;
      prev.endLine = chunk.endLine;
      prev.content = prev.content + '\n' + chunk.content;
    } else {
      merged.push({ ...chunk });
    }
  }
  return merged;
}
