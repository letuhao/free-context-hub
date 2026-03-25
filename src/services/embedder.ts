import { getEnv } from '../env.js';

type EmbeddingResponse = {
  data: Array<{ embedding: number[]; index?: number }>;
};

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const env = getEnv();

  const url = new URL('/v1/embeddings', env.EMBEDDINGS_BASE_URL).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (env.EMBEDDINGS_API_KEY) {
    headers['Authorization'] = `Bearer ${env.EMBEDDINGS_API_KEY}`;
  }

  const input: string | string[] = texts.length === 1 ? texts[0] : texts;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: env.EMBEDDINGS_MODEL,
      input,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[embedTexts] HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as EmbeddingResponse;
  if (!json.data || json.data.length !== texts.length) {
    throw new Error(
      `[embedTexts] Unexpected response shape: data=${json.data?.length ?? 'undefined'} expected=${texts.length}`,
    );
  }

  // OpenAI-compatible APIs typically preserve order. If index exists, we respect it.
  const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map(d => d.embedding);
}

