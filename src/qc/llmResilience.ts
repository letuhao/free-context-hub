/**
 * Moved to src/services/llm/resilience.ts (2026-06-18) — this is an
 * LLM-transport concern, not a qc concern. Kept as a re-export shim so the
 * existing qc importers (genPipeline, judge) keep working unchanged.
 */
export * from '../services/llm/resilience.js';
