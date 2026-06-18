/**
 * Shared LLM client — Phase 17.2.
 *
 * One place for OpenAI-compatible chat transport + normalization. Import from
 * here rather than rolling per-caller `fetch('/v1/chat/completions')`.
 */
export { chatComplete } from './chatComplete.js';
export type { ChatMessage, ChatCompleteParams, ChatCompleteResult } from './chatComplete.js';
export { extractAnswerText, stripReasoningBlocks } from './extractAnswer.js';
export type { RawChatMessage } from './extractAnswer.js';
export { extractJsonObject, extractJsonArray } from './json.js';
export {
  retryOnTransient,
  isTransientLLMError,
  breaker,
  type RetryOptions,
} from './resilience.js';
