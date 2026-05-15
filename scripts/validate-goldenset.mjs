#!/usr/bin/env node
// Validates qc/lessons-queries.json against Phase 12 Sprint 12.1e1 goldenset invariants.
// Exits 0 if clean, 1 on any violation.
// Added 2026-04-19 (Sprint 12.1e1 /review-impl LOW-3).

import { readFileSync } from 'node:fs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CARDINALITY = {
  'ambiguous-multi-target': { min: 2, max: 4 },
  'semantic-paraphrase':    { min: 1, max: 1 },
  'adversarial-miss':       { min: 0, max: 0 },
  // confident-hit, duplicate-trap, cross-topic, real-dogfood — no rule
};

const path = process.argv[2] ?? 'qc/lessons-queries.json';
const raw = readFileSync(path, 'utf8');
let d;
try { d = JSON.parse(raw); } catch (e) {
  console.error(`FAIL: ${path} is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(d?.queries)) {
  console.error(`FAIL: ${path} has no .queries array`);
  process.exit(1);
}

let violations = 0;
const seenIds = new Set();

for (const q of d.queries) {
  const tag = `[${q.id ?? '<no-id>'}]`;

  if (!q.id || typeof q.id !== 'string') {
    console.error(`${tag} FAIL: missing or non-string id`);
    violations++;
    continue;
  }
  if (seenIds.has(q.id)) {
    console.error(`${tag} FAIL: duplicate id`);
    violations++;
  }
  seenIds.add(q.id);

  if (!q.group || typeof q.group !== 'string') {
    console.error(`${tag} FAIL: missing or non-string group`);
    violations++;
  }
  if (!q.query || typeof q.query !== 'string') {
    console.error(`${tag} FAIL: missing or non-string query text`);
    violations++;
  }
  if (!Array.isArray(q.target_lesson_ids)) {
    console.error(`${tag} FAIL: target_lesson_ids is not an array`);
    violations++;
    continue;
  }

  // Cardinality
  const rule = CARDINALITY[q.group];
  if (rule) {
    const n = q.target_lesson_ids.length;
    if (n < rule.min || n > rule.max) {
      const range = rule.min === rule.max ? `exactly ${rule.min}` : `${rule.min}-${rule.max}`;
      console.error(`${tag} FAIL: group=${q.group} requires ${range} targets; has ${n}`);
      violations++;
    }
  }

  // UUID format
  for (const id of q.target_lesson_ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      console.error(`${tag} FAIL: target '${id}' does not look like a UUID`);
      violations++;
    }
  }
}

// Group tally summary
const counts = {};
for (const q of d.queries) counts[q.group] = (counts[q.group] ?? 0) + 1;

if (violations === 0) {
  console.log(`OK: ${d.queries.length} queries, ${Object.keys(counts).length} groups`);
  console.log(`    ${Object.entries(counts).map(([g, n]) => `${g}=${n}`).join(', ')}`);
  process.exit(0);
} else {
  console.error(`\nFAIL: ${violations} violation(s) in ${d.queries.length} queries`);
  process.exit(1);
}
