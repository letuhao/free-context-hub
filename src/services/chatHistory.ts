import { getDbPool } from '../db/client.js';

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  message_id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  metadata: Record<string, unknown> | null;
  pinned: boolean;
  created_at: string;
}

export interface ChatConversation {
  conversation_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Create a new conversation. Title defaults to truncated first message or 'New conversation'. */
export async function createConversation(params: {
  projectId: string;
  title?: string;
}): Promise<ChatConversation> {
  const pool = getDbPool();
  const title = params.title?.trim().slice(0, 120) || 'New conversation';
  const result = await pool.query(
    `INSERT INTO chat_conversations (project_id, title) VALUES ($1, $2) RETURNING *`,
    [params.projectId, title],
  );
  return result.rows[0];
}

/** List conversations for a project, newest first. */
export async function listConversations(params: {
  projectId: string;
  limit?: number;
}): Promise<{ items: ChatConversation[]; total_count: number }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 50, 100);

  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM chat_conversations WHERE project_id = $1`,
    [params.projectId],
  );
  const total_count = parseInt(countRes.rows[0].cnt, 10);

  const result = await pool.query(
    `SELECT conversation_id, project_id, title, created_at, updated_at
     FROM chat_conversations WHERE project_id = $1
     ORDER BY updated_at DESC LIMIT $2`,
    [params.projectId, limit],
  );

  return { items: result.rows, total_count };
}

/** Get a conversation with all its messages. */
export async function getConversation(params: {
  conversationId: string;
  projectId: string;
}): Promise<{ conversation: ChatConversation; messages: ChatMessage[] } | null> {
  const pool = getDbPool();

  const convRes = await pool.query(
    `SELECT * FROM chat_conversations WHERE conversation_id = $1 AND project_id = $2`,
    [params.conversationId, params.projectId],
  );
  if (!convRes.rowCount) return null;

  const msgRes = await pool.query(
    `SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [params.conversationId],
  );

  return {
    conversation: convRes.rows[0],
    messages: msgRes.rows,
  };
}

/** Add a message to a conversation. Updates conversation.updated_at and auto-titles if first user message. */
export async function addMessage(params: {
  conversationId: string;
  projectId: string;
  role: ChatRole;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessage | null> {
  const pool = getDbPool();

  // Verify conversation exists and belongs to project.
  const conv = await pool.query(
    `SELECT conversation_id, title FROM chat_conversations WHERE conversation_id = $1 AND project_id = $2`,
    [params.conversationId, params.projectId],
  );
  if (!conv.rowCount) return null;

  const result = await pool.query(
    `INSERT INTO chat_messages (conversation_id, role, content, metadata)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.conversationId, params.role, params.content, params.metadata ? JSON.stringify(params.metadata) : null],
  );

  // Auto-title from first user message if still default.
  if (params.role === 'user' && conv.rows[0].title === 'New conversation') {
    const autoTitle = params.content.slice(0, 80).replace(/\n/g, ' ').trim();
    await pool.query(
      `UPDATE chat_conversations SET title = $2, updated_at = now() WHERE conversation_id = $1`,
      [params.conversationId, autoTitle],
    );
  } else {
    await pool.query(
      `UPDATE chat_conversations SET updated_at = now() WHERE conversation_id = $1`,
      [params.conversationId],
    );
  }

  return result.rows[0];
}

/** Toggle pinned status on a message. */
export async function toggleMessagePin(params: {
  conversationId: string;
  messageId: string;
}): Promise<{ pinned: boolean } | null> {
  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE chat_messages SET pinned = NOT pinned
     WHERE message_id = $1 AND conversation_id = $2
     RETURNING pinned`,
    [params.messageId, params.conversationId],
  );
  if (!result.rowCount) return null;
  return { pinned: result.rows[0].pinned };
}

/** Delete a conversation and all its messages (CASCADE). */
export async function deleteConversation(params: {
  conversationId: string;
  projectId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM chat_conversations WHERE conversation_id = $1 AND project_id = $2`,
    [params.conversationId, params.projectId],
  );
  return (result.rowCount ?? 0) > 0;
}
