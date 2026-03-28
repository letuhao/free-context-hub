/**
 * Pre-processes text for PostgreSQL full-text search (tsvector/tsquery).
 * Splits camelCase, PascalCase, and snake_case identifiers into component
 * words so that "parseBooleanEnv" becomes "parse boolean env parsebooleanenv"
 * and FTS can match on sub-words.
 */

/**
 * Expand a camelCase/PascalCase identifier into its parts + the original.
 * "getUserById" -> "get user by id getuserbyid"
 * "UPPER_CASE"  -> "upper case upper_case"
 */
function expandIdentifier(token: string): string {
  const parts: string[] = [];

  // Split camelCase / PascalCase
  const camelParts = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .map(p => p.toLowerCase())
    .filter(p => p.length >= 2);

  if (camelParts.length > 1) {
    parts.push(...camelParts);
  }

  // Split snake_case
  if (token.includes('_')) {
    const snakeParts = token.split('_')
      .map(p => p.toLowerCase())
      .filter(p => p.length >= 2);
    if (snakeParts.length > 1) {
      parts.push(...snakeParts);
    }
  }

  // Always keep the original (lowercased) for exact matching.
  parts.push(token.toLowerCase());

  return Array.from(new Set(parts)).join(' ');
}

/**
 * Pre-process text for FTS indexing (to_tsvector input).
 * Finds identifier-like tokens and expands them.
 * Keeps original text intact + appends expanded forms.
 */
export function expandForFtsIndex(text: string): string {
  // Find all identifier-like tokens (camelCase, snake_case, PascalCase).
  const identifiers = text.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [];

  const expansions: string[] = [];
  const seen = new Set<string>();

  for (const id of identifiers) {
    // Only expand tokens that actually have case transitions or underscores.
    if (/[a-z][A-Z]|[A-Z]{2,}[a-z]|_/.test(id)) {
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      expansions.push(expandIdentifier(id));
    }
  }

  // Append expansions to the original text (don't replace — keep original for exact matches).
  if (expansions.length === 0) return text;
  return text + ' ' + expansions.join(' ');
}

/**
 * Pre-process tokens for FTS querying (tsquery input).
 * Expands camelCase/snake_case tokens and joins with OR.
 * Returns a string suitable for to_tsquery('english', ...).
 */
// Common stop words to exclude from FTS queries — they match too broadly.
const FTS_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'and', 'but', 'or', 'not', 'so', 'how', 'what', 'which', 'who',
  'where', 'when', 'why', 'this', 'that', 'it', 'its', 'if',
]);

/**
 * Build a tsquery string from tokens.
 *
 * @param tokens - Search tokens to include.
 * @param mode - 'or' (default): any term matches. 'and': ALL terms must match.
 *               Use 'and' for identifier queries to avoid over-broad matches
 *               (e.g., "assertWorkspaceToken" should require all sub-words).
 */
export function buildFtsQuery(tokens: string[], mode: 'or' | 'and' = 'or'): string {
  const allTerms: string[] = [];

  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z0-9_]/g, '').trim();
    if (cleaned.length < 2) continue;
    // Skip common stop words that match too many chunks.
    if (FTS_STOP_WORDS.has(cleaned.toLowerCase())) continue;

    // Always add the original (lowercased).
    allTerms.push(cleaned.toLowerCase());

    // If it's a compound identifier, add sub-parts.
    if (/[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(cleaned)) {
      const parts = cleaned
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .map(p => p.toLowerCase())
        .filter(p => p.length >= 2);
      allTerms.push(...parts);
    }

    if (cleaned.includes('_')) {
      const parts = cleaned.split('_')
        .map(p => p.toLowerCase())
        .filter(p => p.length >= 2);
      allTerms.push(...parts);
    }
  }

  const unique = Array.from(new Set(allTerms)).slice(0, 20);
  if (unique.length === 0) return '';
  const joiner = mode === 'and' ? ' & ' : ' | ';
  return unique.join(joiner);
}
