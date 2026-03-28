/**
 * Rule-based query decomposition for multi-intent queries.
 * Splits complex queries into independent sub-queries that can be retrieved separately.
 * No LLM dependency -- uses structural patterns to detect multi-intent queries.
 *
 * Examples:
 *   "how does auth work and where is it configured?"
 *     -> ["how does auth work", "where is auth configured"]
 *   "what files import UserService and what methods do they call?"
 *     -> ["what files import UserService", "what methods do UserService importers call"]
 *   "find the job queue and the worker that processes jobs"
 *     -> ["find the job queue", "find the worker that processes jobs"]
 */

/**
 * Decompose a query into sub-queries. Returns the original query if
 * decomposition is not applicable (single intent).
 */
export function decomposeQuery(query: string): string[] {
  const q = query.trim();
  if (!q) return [];

  // Don't decompose very short queries.
  if (q.split(/\s+/).length < 6) return [q];

  const subQueries: string[] = [];

  // Pattern 1: "X and Y" where X and Y are separate questions/phrases.
  // Split on " and " but only when both halves look like independent clauses.
  const andSplit = splitOnConjunction(q, / and (?:also |then |where |how |what |who |which |find |show )/i);
  if (andSplit.length > 1) {
    for (const sub of andSplit) {
      const cleaned = cleanSubQuery(sub, q);
      if (cleaned) subQueries.push(cleaned);
    }
    if (subQueries.length > 1) return dedupeAndLimit(subQueries);
  }

  // Pattern 2: Comma-separated list of questions.
  // "show auth middleware, env configuration, and routing setup"
  const commaSplit = splitOnCommaList(q);
  if (commaSplit.length > 1) {
    for (const sub of commaSplit) {
      const cleaned = cleanSubQuery(sub, q);
      if (cleaned) subQueries.push(cleaned);
    }
    if (subQueries.length > 1) return dedupeAndLimit(subQueries);
  }

  // Pattern 3: Multiple question words.
  // "how does X work? where is Y defined?"
  const questionSplit = splitOnQuestionBoundaries(q);
  if (questionSplit.length > 1) {
    return dedupeAndLimit(questionSplit);
  }

  // No decomposition applicable.
  return [q];
}

function splitOnConjunction(query: string, pattern: RegExp): string[] {
  const match = query.match(pattern);
  if (!match || match.index === undefined) return [];

  const before = query.slice(0, match.index).trim();
  const after = query.slice(match.index + match[0].length).trim();

  // Both halves should be substantial.
  if (before.split(/\s+/).length < 3 || after.split(/\s+/).length < 3) return [];

  return [before, after];
}

function splitOnCommaList(query: string): string[] {
  // Detect pattern: "verb X, Y, and Z" or "find X, Y, Z"
  const parts = query.split(/,\s*(?:and\s+)?/);
  if (parts.length < 2) return [];

  // All parts after the first might be short noun phrases.
  // Extract the leading verb/context from the first part.
  const firstPart = parts[0]!.trim();
  const verbMatch = firstPart.match(/^((?:find|show|where is|how does|what is|get|list|search for)\s+)/i);
  const verb = verbMatch ? verbMatch[1]! : '';

  const results: string[] = [firstPart];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!.trim();
    if (!part) continue;
    // If the part is just a short phrase, prepend the verb for context.
    if (verb && part.split(/\s+/).length < 4 && !/^(where|how|what|find|show)/i.test(part)) {
      results.push(verb + part);
    } else {
      results.push(part);
    }
  }

  return results.filter(r => r.split(/\s+/).length >= 2);
}

function splitOnQuestionBoundaries(query: string): string[] {
  // Split on question marks or on "where/how/what" boundaries when mid-sentence.
  const questionPattern = /[?]\s+/;
  if (questionPattern.test(query)) {
    return query.split(questionPattern)
      .map(s => s.trim().replace(/[?]+$/, '').trim())
      .filter(s => s.split(/\s+/).length >= 3);
  }

  // Split on mid-sentence question words (capitalized or after punctuation).
  const midQuestionPattern = /(?:\.|\?|!)\s+((?:where|how|what|which|who|find)\b)/i;
  const match = query.match(midQuestionPattern);
  if (match && match.index !== undefined) {
    const before = query.slice(0, match.index + 1).trim();
    const after = query.slice(match.index + match[0].length - match[1]!.length).trim();
    if (before.split(/\s+/).length >= 3 && after.split(/\s+/).length >= 3) {
      return [before.replace(/[.?!]+$/, '').trim(), after];
    }
  }

  return [];
}

function cleanSubQuery(sub: string, originalQuery: string): string {
  let s = sub.trim().replace(/^(and|also|then|,)\s*/i, '').trim();
  // Remove trailing punctuation.
  s = s.replace(/[.,;!?]+$/, '').trim();
  // If too short, skip.
  if (s.split(/\s+/).length < 2) return '';
  // If identical to original, skip.
  if (s.toLowerCase() === originalQuery.toLowerCase()) return '';
  return s;
}

function dedupeAndLimit(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of queries) {
    const key = q.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(q);
  }
  // Max 3 sub-queries to avoid latency explosion.
  return result.slice(0, 3);
}
