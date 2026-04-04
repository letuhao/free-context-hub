import { pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'chat' as const;
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/**
 * Test: Chat conversation CRUD lifecycle
 * create → add messages → list → get with messages → pin → delete → 404
 */
export const chatConversationCrud: TestFn = async (ctx) => {
  const name = 'chat-conversation-crud';
  const start = Date.now();

  try {
    // 1. Create conversation.
    const createRes = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId }),
    });
    if (createRes.status !== 201) return fail(name, GROUP, Date.now() - start, `Create returned ${createRes.status}`);
    const conv = await createRes.json() as any;
    const convId = conv.conversation_id;
    if (!convId) return fail(name, GROUP, Date.now() - start, 'No conversation_id returned');
    if (conv.title !== 'New conversation') return fail(name, GROUP, Date.now() - start, `Default title wrong: ${conv.title}`);

    // 2. Add user message → should auto-title.
    const msg1Res = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, role: 'user', content: 'What are our key decisions?' }),
    });
    if (msg1Res.status !== 201) return fail(name, GROUP, Date.now() - start, `Add msg1 returned ${msg1Res.status}`);
    const msg1 = await msg1Res.json() as any;
    if (!msg1.message_id) return fail(name, GROUP, Date.now() - start, 'No message_id for msg1');

    // 3. Add assistant message with metadata.
    const msg2Res = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, role: 'assistant', content: 'Here are the decisions...', metadata: { model: 'test-model' } }),
    });
    if (msg2Res.status !== 201) return fail(name, GROUP, Date.now() - start, `Add msg2 returned ${msg2Res.status}`);
    const msg2 = await msg2Res.json() as any;
    if (msg2.metadata?.model !== 'test-model') return fail(name, GROUP, Date.now() - start, `Metadata not stored: ${JSON.stringify(msg2.metadata)}`);

    // 4. List conversations — should find ours with auto-title.
    const listRes = await fetch(`${API_BASE}/api/chat/conversations?project_id=${ctx.projectId}`);
    const list = await listRes.json() as any;
    const found = list.items?.find((c: any) => c.conversation_id === convId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Conversation not in list');
    if (found.title !== 'What are our key decisions?') return fail(name, GROUP, Date.now() - start, `Auto-title wrong: ${found.title}`);

    // 5. Get conversation with messages.
    const getRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}?project_id=${ctx.projectId}`);
    const detail = await getRes.json() as any;
    if (detail.messages?.length !== 2) return fail(name, GROUP, Date.now() - start, `Expected 2 messages, got ${detail.messages?.length}`);
    if (detail.messages[0].role !== 'user') return fail(name, GROUP, Date.now() - start, `First msg role=${detail.messages[0].role}`);
    if (detail.messages[1].role !== 'assistant') return fail(name, GROUP, Date.now() - start, `Second msg role=${detail.messages[1].role}`);

    // 6. Pin a message.
    const pinRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages/${msg1.message_id}/pin`, { method: 'PATCH' });
    const pin = await pinRes.json() as any;
    if (pin.pinned !== true) return fail(name, GROUP, Date.now() - start, `Pin returned ${pin.pinned}`);

    // 7. Unpin.
    const unpinRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages/${msg1.message_id}/pin`, { method: 'PATCH' });
    const unpin = await unpinRes.json() as any;
    if (unpin.pinned !== false) return fail(name, GROUP, Date.now() - start, `Unpin returned ${unpin.pinned}`);

    // 8. Delete conversation.
    const delRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}?project_id=${ctx.projectId}`, { method: 'DELETE' });
    const del = await delRes.json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Delete returned ${del.status}`);

    // 9. 404 after delete.
    const gone = await fetch(`${API_BASE}/api/chat/conversations/${convId}?project_id=${ctx.projectId}`);
    if (gone.status !== 404) return fail(name, GROUP, Date.now() - start, `Expected 404 after delete, got ${gone.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test: Chat cross-project isolation
 * Conversation in project A should not be accessible from project B.
 */
export const chatProjectIsolation: TestFn = async (ctx) => {
  const name = 'chat-project-isolation';
  const start = Date.now();

  try {
    // Create conversation in project A.
    const createRes = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, title: 'Isolation test' }),
    });
    const conv = await createRes.json() as any;
    const convId = conv.conversation_id;

    // Try to get from different project → 404.
    const crossRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}?project_id=wrong-project`);
    if (crossRes.status !== 404) return fail(name, GROUP, Date.now() - start, `Cross-project access returned ${crossRes.status}, expected 404`);

    // Try to add message from different project → 404.
    const crossMsgRes = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'wrong-project', role: 'user', content: 'Should fail' }),
    });
    if (crossMsgRes.status !== 404) return fail(name, GROUP, Date.now() - start, `Cross-project message returned ${crossMsgRes.status}`);

    // Cleanup.
    await fetch(`${API_BASE}/api/chat/conversations/${convId}?project_id=${ctx.projectId}`, { method: 'DELETE' });

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allChatHistoryTests: TestFn[] = [chatConversationCrud, chatProjectIsolation];
