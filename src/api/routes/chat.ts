import { Router } from 'express';
import type { Request } from 'express';
import { requireProjectScope } from '../middleware/requireResourceScope.js';
import { streamText, tool, stepCountIs, convertToModelMessages } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import * as z from 'zod/v4';
import {
  getEnv,
  resolveProjectIdOrThrow,
  searchLessons,
  checkGuardrails,
  tieredSearch,
  createModuleLogger,
} from '../../core/index.js';
import type { CallerScope } from '../../core/index.js';
import { searchChunks } from '../../services/documentChunks.js';
import { callerPrincipalOf } from '../middleware/auth.js';

/** DEFERRED-029: read the caller's project scope attached by bearerAuth. */
function callerScopeOf(req: Request): CallerScope {
  return (req as { apiKeyScope?: CallerScope }).apiKeyScope;
}

const logger = createModuleLogger('chat');
const router = Router();

/** POST /api/chat — AI chat with streaming + tool calling */
router.post('/', requireProjectScope('body'), async (req, res, next) => {
  try {
    const env = getEnv();

    if (!env.DISTILLATION_ENABLED || !env.DISTILLATION_BASE_URL || !env.DISTILLATION_MODEL) {
      res.status(503).json({
        error: 'Chat requires DISTILLATION_ENABLED=true with DISTILLATION_BASE_URL and DISTILLATION_MODEL configured.',
      });
      return;
    }

    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const messages = req.body.messages ?? [];

    const provider = createOpenAICompatible({
      name: 'contexthub-chat',
      baseURL: `${env.DISTILLATION_BASE_URL}/v1`,
      apiKey: env.DISTILLATION_API_KEY ?? 'no-key',
    });

    const model = provider.chatModel(env.DISTILLATION_MODEL);
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model,
      system: `You are a knowledge assistant for the project "${projectId}".
You help users understand their project by searching lessons, documents, guardrails, and code.
Use the available tools to look up information before answering.
Prefer search_documents when the user asks about content that lives in uploaded PDFs, DOCX, or image files.
Always cite which lessons, documents (with page numbers if available), or code files your answer is based on.
Be concise and direct. Use markdown formatting.`,
      messages: modelMessages,
      tools: {
        search_lessons: tool({
          description: 'Search project lessons, decisions, workarounds, and guardrails.',
          inputSchema: z.object({
            query: z.string().describe('Natural language search query'),
          }),
          execute: async ({ query }) => {
            logger.info({ projectId, query }, 'chat tool: search_lessons');
            // DEFERRED-038: feed the chat answerer the FULL lesson, not the
            // 280-char display preview (mirrors the search_documents fix). A
            // lesson whose decision/content sits past char 280 otherwise can't
            // be grounded on by the assistant.
            return searchLessons({ projectId, actingPrincipalId: callerPrincipalOf(req), query, limit: 5, snippetMaxChars: 2000 });
          },
        }),
        check_guardrails: tool({
          description: 'Check if an action is allowed by project guardrails.',
          inputSchema: z.object({
            action: z.string().describe('Description of the action to check'),
          }),
          execute: async ({ action }) => {
            logger.info({ projectId, action }, 'chat tool: check_guardrails');
            return checkGuardrails(projectId, { action });
          },
        }),
        search_documents: tool({
          description:
            'Search extracted document chunks (PDFs, DOCX, images) by semantic similarity. ' +
            'Returns chunks with the parent document name, page number, and heading so ' +
            'answers can cite the exact source.',
          inputSchema: z.object({
            query: z.string().describe('Natural language search query'),
            chunk_types: z
              .array(z.enum(['text', 'table', 'code', 'diagram_description', 'mermaid']))
              .optional()
              .describe('Optional filter to specific chunk types'),
          }),
          execute: async ({ query, chunk_types }) => {
            logger.info({ projectId, query, chunk_types }, 'chat tool: search_documents');
            const res = await searchChunks({
              projectId,
              actingPrincipalId: callerPrincipalOf(req),
              query,
              limit: 5,
              chunkTypes: chunk_types as any,
              // DEFERRED-038: feed the chat answerer the FULL chunk, not the
              // 240-char display preview. A grounding fact past char 240 otherwise
              // reads as "Not in context" (proven by the aieng-corpus benchmark:
              // standard faithfulness 0.62→0.82 once the full chunk was fed).
              // 2000 ≈ the chunker's max chunk size, so this is full-chunk without
              // unbounded growth; 5 chunks × ≤2000 ≈ 2.5k context tokens/turn.
              snippetMaxChars: 2000,
            });
            // Return a shape optimized for the LLM: doc name + page + heading + snippet
            return {
              matches: res.matches.map((m) => ({
                doc_name: m.doc_name,
                doc_id: m.doc_id,
                page: m.page_number,
                heading: m.heading,
                chunk_type: m.chunk_type,
                snippet: m.content_snippet,
                score: m.score,
              })),
            };
          },
        }),
        search_code: tool({
          description: 'Search project source code by identifier, file path, or description.',
          inputSchema: z.object({
            query: z.string().describe('Code search query'),
            kind: z.string().optional().describe('Filter: source, test, doc, config, etc.'),
          }),
          execute: async ({ query, kind }) => {
            logger.info({ projectId, query, kind }, 'chat tool: search_code');
            return tieredSearch({ projectId, callerScope: callerScopeOf(req), query, kind: kind as any, maxFiles: 5 });
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });

    result.pipeTextStreamToResponse(res);
  } catch (error) {
    logger.error({ error }, 'chat error');
    next(error);
  }
});

export { router as chatRouter };
