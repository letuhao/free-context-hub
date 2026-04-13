# Architecture Decision Records

This document captures key architectural decisions for the project.

## 1. Retry Strategy

All external API calls must implement exponential backoff with a maximum of 3 retry attempts.
The base delay is 1 second with a multiplier of 2.

### 1.1 Configuration

The retry configuration applies to all HTTP clients in the codebase.

| Parameter | Default | Description |
|-----------|---------|-------------|
| maxRetries | 3 | Maximum number of attempts |
| baseDelay | 1000ms | Initial delay before first retry |
| multiplier | 2.0 | Exponential backoff multiplier |
| jitter | true | Add random jitter to prevent thundering herd |

### 1.2 Implementation

The retry middleware wraps fetch and intercepts failed requests.

```typescript
async function retryFetch(url: string, options: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}
```

## 2. Authentication

All endpoints require an API key in the Authorization header.

The API key format is `Bearer <key>` where the key is a SHA-256 hash.
Keys are scoped to a single project unless granted admin role.

### 2.1 Roles

We have three roles:

- **admin**: full read/write access to all projects
- **writer**: read/write access to assigned projects only
- **reader**: read-only access

## 3. Data Storage

Lessons are stored in PostgreSQL with pgvector for embeddings. Each lesson has a 768-dimensional vector embedding generated from its content.

The vector dimension is fixed by the embedding model. Switching models requires a full re-index.
