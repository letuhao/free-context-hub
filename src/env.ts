import * as z from 'zod/v4';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  EMBEDDINGS_BASE_URL: z
    .string()
    .min(1, 'EMBEDDINGS_BASE_URL is required')
    .default('http://127.0.0.1:1234'),

  EMBEDDINGS_API_KEY: z.string().optional(),

  // From your curl command (OpenAI-compatible embeddings endpoint).
  EMBEDDINGS_MODEL: z.string().min(1, 'EMBEDDINGS_MODEL is required').default('mixedbread-ai/text-embedding-mxbai-embed-large-v1'),

  // Single MVP workspace token for all MCP tool calls.
  CONTEXT_HUB_WORKSPACE_TOKEN: z.string().min(1, 'CONTEXT_HUB_WORKSPACE_TOKEN is required'),

  MCP_PORT: z.coerce.number().int().positive().optional().default(3000),

  // Vector dimension must match the embedding model configured above.
  EMBEDDINGS_DIM: z.coerce.number().int().positive().optional().default(1024),

  // Chunking: number of lines per chunk for MVP.
  CHUNK_LINES: z.coerce.number().int().positive().optional().default(120),
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

