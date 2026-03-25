import * as z from 'zod/v4';

function parseBooleanEnv(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return undefined;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  EMBEDDINGS_BASE_URL: z
    .string()
    .min(1, 'EMBEDDINGS_BASE_URL is required')
    .default('http://127.0.0.1:1234'),

  EMBEDDINGS_API_KEY: z.string().optional(),

  // From your curl command (OpenAI-compatible embeddings endpoint).
  EMBEDDINGS_MODEL: z.string().min(1, 'EMBEDDINGS_MODEL is required').default('mixedbread-ai/text-embedding-mxbai-embed-large-v1'),

  // When enabled, every MCP tool call must include `workspace_token` matching `CONTEXT_HUB_WORKSPACE_TOKEN`.
  // When disabled (default), `workspace_token` becomes optional for easier agent compliance.
  MCP_AUTH_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),

  // Single MVP workspace token for all MCP tool calls.
  // Optional unless MCP_AUTH_ENABLED=true.
  CONTEXT_HUB_WORKSPACE_TOKEN: z.string().min(1, 'CONTEXT_HUB_WORKSPACE_TOKEN is required').optional(),

  // When provided, MCP tools may omit project_id and fallback to this default.
  // If a tool allows missing project_id and this env is missing, the tool returns Bad Request.
  DEFAULT_PROJECT_ID: z.string().min(1).optional(),

  MCP_PORT: z.coerce.number().int().positive().optional().default(3000),

  // Vector dimension must match the embedding model configured above.
  EMBEDDINGS_DIM: z.coerce.number().int().positive().optional().default(1024),

  // Chunking: number of lines per chunk for MVP.
  CHUNK_LINES: z.coerce.number().int().positive().optional().default(120),

  // Phase 3: OpenAI-compatible chat for distillation / reflect / compress (defaults to embeddings base URL).
  DISTILLATION_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  DISTILLATION_BASE_URL: z.string().min(1).optional(),
  DISTILLATION_API_KEY: z.string().optional(),
  DISTILLATION_MODEL: z.string().min(1).optional(),
  DISTILLATION_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(12_000),
  REFLECT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(5000),
}).superRefine((val, ctx) => {
  if (val.MCP_AUTH_ENABLED && (!val.CONTEXT_HUB_WORKSPACE_TOKEN || val.CONTEXT_HUB_WORKSPACE_TOKEN.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONTEXT_HUB_WORKSPACE_TOKEN'],
      message: 'CONTEXT_HUB_WORKSPACE_TOKEN is required when MCP_AUTH_ENABLED=true',
    });
  }
  if (val.DISTILLATION_ENABLED && (!val.DISTILLATION_MODEL || !val.DISTILLATION_MODEL.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DISTILLATION_MODEL'],
      message: 'DISTILLATION_MODEL is required when DISTILLATION_ENABLED=true',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

