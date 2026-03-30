import { Router } from 'express';
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

const logger = createModuleLogger('chat');
const router = Router();

/** POST /api/chat — AI chat with streaming + tool calling */
router.post('/', async (req, res, next) => {
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
You help users understand their project by searching lessons, checking guardrails, and finding code.
Use the available tools to look up information before answering.
Always cite which lessons or code files your answer is based on.
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
            return searchLessons({ projectId, query, limit: 5 });
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
        search_code: tool({
          description: 'Search project source code by identifier, file path, or description.',
          inputSchema: z.object({
            query: z.string().describe('Code search query'),
            kind: z.string().optional().describe('Filter: source, test, doc, config, etc.'),
          }),
          execute: async ({ query, kind }) => {
            logger.info({ projectId, query, kind }, 'chat tool: search_code');
            return tieredSearch({ projectId, query, kind: kind as any, maxFiles: 5 });
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
