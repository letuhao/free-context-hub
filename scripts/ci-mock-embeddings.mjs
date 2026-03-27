/**
 * Minimal OpenAI-compatible /v1/embeddings server for CI (fixed 1024-dim vectors).
 * Listens on 0.0.0.0:1234. Use EMBEDDINGS_DIM=1024 in ContextHub env.
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_EMBEDDINGS_PORT ?? 1234);
const DIM = 1024;

function embeddingForIndex(i) {
  const v = new Array(DIM);
  for (let j = 0; j < DIM; j++) v[j] = (((i + j) % 997) / 997) * 2 - 1;
  return v;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/embeddings')) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  req.on('data', c => {
    body += c;
  });
  req.on('end', () => {
    let json;
    try {
      json = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const input = json.input;
    const parts = Array.isArray(input) ? input : [input];
    const data = parts.map((_, i) => ({
      object: 'embedding',
      embedding: embeddingForIndex(i),
      index: i,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data,
        model: json.model || 'mock-ci',
      }),
    );
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ci-mock-embeddings] listening on :${PORT} dim=${DIM}`);
});
