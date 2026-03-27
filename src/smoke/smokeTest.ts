import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

function getEnvOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function extractFirstTextJson(result: any) {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') {
    throw new Error(`Tool result did not contain text content; got: ${JSON.stringify(content)}`);
  }

  // Default `output_format=auto_both` may prefix summary text.
  // Extract the first JSON object/array substring and parse it.
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const firstObj = raw.indexOf('{');
    const firstArr = raw.indexOf('[');
    let start = -1;
    if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
    else start = firstObj >= 0 ? firstObj : firstArr;

    const lastObj = raw.lastIndexOf('}');
    const lastArr = raw.lastIndexOf(']');
    let end = -1;
    if (lastObj >= 0 && lastArr >= 0) end = Math.max(lastObj, lastArr);
    else end = lastObj >= 0 ? lastObj : lastArr;

    if (start >= 0 && end >= start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error(`Failed to parse JSON from tool content.text: ${raw.slice(0, 200)}`);
  }
}

async function main() {
  // Server-side auth can be enabled/disabled independently of this test process.
  // To reduce friction, always send workspace_token when available; server ignores it when auth is disabled.
  const token = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const tokenArgs = token && token.trim().length ? { workspace_token: token } : {};
  const projectIdA = process.env.SMOKE_PROJECT_ID_A ?? 'demo-project-A';
  const projectIdB = process.env.SMOKE_PROJECT_ID_B ?? 'demo-project-B';
  const root = process.env.SMOKE_ROOT ?? process.cwd();
  const gitRoot = process.env.SMOKE_GIT_ROOT ?? root;
  const serverUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3000/mcp';

  const client = new Client(
    { name: 'contexthub-smoke-client', version: '0.1.0' },
    {
      capabilities: {},
    },
  );

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});
  await client.connect(transport);

  console.log('[smoke] connected');

  try {
    const listTools = await client.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema,
    );
    console.log('[smoke] tools:', listTools.tools.map((t: any) => t.name).join(', '));

    const names = new Set(listTools.tools.map((t: any) => String(t.name)));
    const requiredTools = [
      'help',
      'index_project',
      'search_code',
      'list_lessons',
      'search_lessons',
      'add_lesson',
      'check_guardrails',
      'get_context',
      'delete_workspace',
      'update_lesson_status',
      'get_project_summary',
      'reflect',
      'compress_context',
      'search_symbols',
      'get_symbol_neighbors',
      'trace_dependency_path',
      'get_lesson_impact',
      'ingest_git_history',
      'list_commits',
      'get_commit',
      'suggest_lessons_from_commits',
      'link_commit_to_lesson',
      'analyze_commit_impact',
    ];
    for (const n of requiredTools) {
      if (!names.has(n)) {
        throw new Error(`Missing tool: ${n}`);
      }
    }

    // Best-effort: ensure descriptions exist (helps agent integration).
    const missingDesc = (listTools.tools ?? []).filter((t: any) => !t?.description || String(t.description).trim().length === 0);
    if (missingDesc.length > 0) {
      throw new Error(`tools/list returned tools with empty description: ${missingDesc.map((t: any) => t.name).join(', ')}`);
    }
  } catch (e) {
    console.warn('[smoke] tools/list failed (continuing):', e);
  }

  console.log('[smoke] help...');
  const helpResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'help',
        arguments: {
          ...tokenArgs,
          output_format: 'json_only',
        },
      },
    },
    CallToolResultSchema,
  );
  const helpJson = extractFirstTextJson(helpResult);
  const helpToolsCount = helpJson.tools?.length ?? 0;
  const helpWorkflowsCount = helpJson.workflows?.length ?? 0;
  console.log('[smoke] help tools/workflows:', helpToolsCount, helpWorkflowsCount);
  if (helpToolsCount === 0 || helpWorkflowsCount === 0) {
    throw new Error('help returned empty tools/workflows');
  }

  console.log('[smoke] index_project...');
  console.log(`[smoke] index_project(A=${projectIdA})...`);
  const indexedResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'index_project',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          root,
          options: {
            lines_per_chunk: 120,
            embedding_batch_size: 8,
          },
        },
      },
    },
    CallToolResultSchema,
  );
  const indexedJsonA = extractFirstTextJson(indexedResultA);
  console.log('[smoke] index_project(A) result:', indexedJsonA);

  console.log(`[smoke] index_project(B=${projectIdB})...`);
  const indexedResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'index_project',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          root,
          options: {
            lines_per_chunk: 120,
            embedding_batch_size: 8,
          },
        },
      },
    },
    CallToolResultSchema,
  );
  const indexedJsonB = extractFirstTextJson(indexedResultB);
  console.log('[smoke] index_project(B) result:', indexedJsonB);

  console.log('[smoke] search_code (before delete)...');
  const searchResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchJsonA = extractFirstTextJson(searchResultA);
  const matchesBeforeA = searchJsonA.matches?.length ?? 0;
  console.log('[smoke] search_code matches (A):', matchesBeforeA);

  const searchResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchJsonB = extractFirstTextJson(searchResultB);
  const matchesBeforeB = searchJsonB.matches?.length ?? 0;
  console.log('[smoke] search_code matches (B):', matchesBeforeB);

  if (matchesBeforeA === 0) {
    throw new Error(`Precondition failed: search_code matches for project A is 0 (projectIdA=${projectIdA})`);
  }
  if (matchesBeforeB === 0) {
    throw new Error(`Precondition failed: search_code matches for project B is 0 (projectIdB=${projectIdB})`);
  }

  console.log('[smoke] add_lesson (preference) for A...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdA,
            lesson_type: 'preference',
            title: 'Use TypeScript',
            content: 'We use strict TypeScript for all services.',
            tags: ['preference-typescript'],
            source_refs: ['smoke-test'],
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] add_lesson (preference) for B...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdB,
            lesson_type: 'preference',
            title: 'Use PostgreSQL',
            content: 'We store metadata in PostgreSQL.',
            tags: ['preference-postgres'],
            source_refs: ['smoke-test'],
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] list_lessons (before delete)...');
  const listResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'list_lessons',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          page: { limit: 20 },
        },
      },
    },
    CallToolResultSchema,
  );
  const listJsonA = extractFirstTextJson(listResultA);
  const lessonsCountBeforeA = listJsonA.items?.length ?? 0;
  console.log('[smoke] lessons (A):', lessonsCountBeforeA);

  const listResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'list_lessons',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          page: { limit: 20 },
        },
      },
    },
    CallToolResultSchema,
  );
  const listJsonB = extractFirstTextJson(listResultB);
  const lessonsCountBeforeB = listJsonB.items?.length ?? 0;
  console.log('[smoke] lessons (B):', lessonsCountBeforeB);

  if (lessonsCountBeforeA === 0) throw new Error(`Precondition failed: list_lessons for project A is empty (projectIdA=${projectIdA})`);
  if (lessonsCountBeforeB === 0) throw new Error(`Precondition failed: list_lessons for project B is empty (projectIdB=${projectIdB})`);

  console.log('[smoke] get_project_summary (A)...');
  const summaryAResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_project_summary',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          output_format: 'json_only',
        },
      },
    },
    CallToolResultSchema,
  );
  const summaryAJson = extractFirstTextJson(summaryAResult);
  const summaryChars = String(summaryAJson.body ?? '').length;
  console.log('[smoke] get_project_summary chars (A):', summaryChars);
  if (summaryChars === 0) {
    throw new Error('get_project_summary returned empty body unexpectedly');
  }

  console.log('[smoke] compress_context...');
  const compressResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'compress_context',
        arguments: {
          ...tokenArgs,
          text: 'This is a long repeated note. '.repeat(20),
          max_output_chars: 400,
          output_format: 'json_only',
        },
      },
    },
    CallToolResultSchema,
  );
  const compressJson = extractFirstTextJson(compressResult);
  if (!compressJson.compressed || String(compressJson.compressed).length === 0) {
    throw new Error('compress_context returned empty compressed text');
  }

  console.log('[smoke] reflect (A)...');
  const reflectResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'reflect',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          topic: 'TypeScript preferences',
          output_format: 'json_only',
        },
      },
    },
    CallToolResultSchema,
  );
  const reflectJson = extractFirstTextJson(reflectResult);
  console.log('[smoke] reflect answer chars:', String(reflectJson.answer ?? '').length, 'warning:', reflectJson.warning ?? '');

  console.log('[smoke] kg tools (best-effort)...');
  const kgEnabled = String(process.env.KG_ENABLED ?? '').toLowerCase() === 'true';
  if (kgEnabled) {
    const symSearch = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'search_symbols',
          arguments: {
            ...tokenArgs,
            project_id: projectIdA,
            query: 'index',
            limit: 5,
            output_format: 'json_only',
          },
        },
      },
      CallToolResultSchema,
    );
    const symJson = extractFirstTextJson(symSearch);
    const firstSym = symJson.matches?.[0]?.symbol_id as string | undefined;
    console.log('[smoke] search_symbols matches:', symJson.matches?.length ?? 0);

    if (firstSym) {
      const neigh = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_symbol_neighbors',
            arguments: {
              ...tokenArgs,
              project_id: projectIdA,
              symbol_id: firstSym,
              depth: 1,
              limit: 20,
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const neighJson = extractFirstTextJson(neigh);
      console.log('[smoke] get_symbol_neighbors:', neighJson.neighbors?.length ?? 0);

      const secondSym = symJson.matches?.[1]?.symbol_id as string | undefined;
      if (secondSym) {
        const trace = await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'trace_dependency_path',
              arguments: {
                ...tokenArgs,
                project_id: projectIdA,
                from_symbol_id: firstSym,
                to_symbol_id: secondSym,
                max_hops: 12,
                output_format: 'json_only',
              },
            },
          },
          CallToolResultSchema,
        );
        const traceJson = extractFirstTextJson(trace);
        console.log('[smoke] trace_dependency_path found:', traceJson.found);
      }
    }

    const addForKg = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_lesson',
          arguments: {
            ...tokenArgs,
            lesson_payload: {
              project_id: projectIdA,
              lesson_type: 'decision',
              title: 'KG link smoke',
              content: 'Links to a file in this repo for graph testing.',
              tags: ['kg-smoke'],
              source_refs: ['src/index.ts'],
            },
          },
        },
      },
      CallToolResultSchema,
    );
    const addKgJson = extractFirstTextJson(addForKg);
    const lessonIdKg = String(addKgJson.lesson_id ?? '');
    if (lessonIdKg) {
      const impact = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_lesson_impact',
            arguments: {
              ...tokenArgs,
              project_id: projectIdA,
              lesson_id: lessonIdKg,
              limit: 20,
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const impactJson = extractFirstTextJson(impact);
      console.log('[smoke] get_lesson_impact linked_symbols:', impactJson.linked_symbols?.length ?? 0);
    }
  } else {
    console.log('[smoke] KG_ENABLED!=true; skipping Neo4j graph assertions');
  }

  console.log('[smoke] git intelligence tools (best-effort)...');
  const gitEnabled = String(process.env.GIT_INGEST_ENABLED ?? '').toLowerCase() === 'true';
  if (gitEnabled) {
    const ingest = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'ingest_git_history',
          arguments: {
            ...tokenArgs,
            project_id: projectIdA,
            root: gitRoot,
            max_commits: 20,
            output_format: 'json_only',
          },
        },
      },
      CallToolResultSchema,
    );
    const ingestJson = extractFirstTextJson(ingest);
    console.log('[smoke] ingest_git_history status:', ingestJson.status, 'commits:', ingestJson.commits_upserted);
    if (String(ingestJson.status) === 'error') {
      throw new Error(`ingest_git_history returned error: ${String(ingestJson.error ?? '(no error detail)')}`);
    }

    const listCommits = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'list_commits',
          arguments: {
            ...tokenArgs,
            project_id: projectIdA,
            limit: 5,
            output_format: 'json_only',
          },
        },
      },
      CallToolResultSchema,
    );
    const listCommitsJson = extractFirstTextJson(listCommits);
    const firstCommit = listCommitsJson.items?.[0]?.sha as string | undefined;
    console.log('[smoke] list_commits count:', listCommitsJson.items?.length ?? 0);
    if (!firstCommit) {
      throw new Error('list_commits returned empty unexpectedly after ingest_git_history');
    }

    if (firstCommit) {
      const getCommitResult = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_commit',
            arguments: {
              ...tokenArgs,
              project_id: projectIdA,
              sha: firstCommit,
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const getCommitJson = extractFirstTextJson(getCommitResult);
      console.log('[smoke] get_commit files:', getCommitJson.files?.length ?? 0);

      const suggest = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'suggest_lessons_from_commits',
            arguments: {
              ...tokenArgs,
              project_id: projectIdA,
              commit_shas: [firstCommit],
              limit: 1,
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const suggestJson = extractFirstTextJson(suggest);
      console.log('[smoke] suggest_lessons_from_commits proposals:', suggestJson.proposals?.length ?? 0);

      const newLesson = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_lesson',
            arguments: {
              ...tokenArgs,
              lesson_payload: {
                project_id: projectIdA,
                lesson_type: 'general_note',
                title: 'Git link smoke lesson',
                content: 'Temporary lesson for linking commit references in smoke.',
                tags: ['smoke', 'phase5'],
              },
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const newLessonJson = extractFirstTextJson(newLesson);
      const newLessonId = String(newLessonJson.lesson_id ?? '');

      if (newLessonId) {
        const link = await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'link_commit_to_lesson',
              arguments: {
                ...tokenArgs,
                project_id: projectIdA,
                commit_sha: firstCommit,
                lesson_id: newLessonId,
                output_format: 'json_only',
              },
            },
          },
          CallToolResultSchema,
        );
        const linkJson = extractFirstTextJson(link);
        console.log('[smoke] link_commit_to_lesson status:', linkJson.status, 'refs:', linkJson.linked_refs);
      }

      const impact = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'analyze_commit_impact',
            arguments: {
              ...tokenArgs,
              project_id: projectIdA,
              commit_sha: firstCommit,
              limit: 20,
              output_format: 'json_only',
            },
          },
        },
        CallToolResultSchema,
      );
      const impactJson = extractFirstTextJson(impact);
      console.log('[smoke] analyze_commit_impact files/symbols/lessons:', impactJson.affected_files?.length ?? 0, impactJson.affected_symbols?.length ?? 0, impactJson.related_lessons?.length ?? 0);
    }
  } else {
    console.log('[smoke] GIT_INGEST_ENABLED!=true; skipping phase 5 git intelligence assertions');
  }

  console.log('[smoke] search_lessons (A)...');
  const searchLessonsResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_lessons',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          query: 'TypeScript',
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchLessonsJsonA = extractFirstTextJson(searchLessonsResultA);
  const lessonMatchesA = searchLessonsJsonA.matches?.length ?? 0;
  console.log('[smoke] search_lessons matches (A):', lessonMatchesA);
  if (lessonMatchesA === 0) {
    throw new Error(`Precondition failed: search_lessons matches for project A is 0 (projectIdA=${projectIdA})`);
  }

  console.log('[smoke] get_context (A)...');
  const ctxResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_context',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          task: { intent: 'Find guardrails docs', query: 'guardrails', path_glob: 'docs/**/*.md' },
        },
      },
    },
    CallToolResultSchema,
  );
  const ctxJsonA = extractFirstTextJson(ctxResultA);
  const refs = ctxJsonA.context_refs?.length ?? 0;
  const suggestions = ctxJsonA.suggested_next_calls?.length ?? 0;
  console.log('[smoke] get_context refs/suggestions:', refs, suggestions);
  if (refs === 0) throw new Error('get_context returned empty context_refs');

  console.log('[smoke] add_lesson (guardrail) for A...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdA,
            lesson_type: 'guardrail',
            title: 'No push without tests',
            content: 'Do not push without running tests.',
            tags: ['guardrail-ci', 'preference-safety'],
            guardrail: {
              trigger: 'git push',
              requirement: 'Run tests locally before any git push.',
              verification_method: 'user_confirmation',
            },
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] check_guardrails for A...');
  const guardResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'check_guardrails',
        arguments: {
          ...tokenArgs,
          action_context: { action: 'git push', workspace: projectIdA },
        },
      },
    },
    CallToolResultSchema,
  );
  const guardJson = extractFirstTextJson(guardResult);
  console.log('[smoke] check_guardrails result:', guardJson);

  console.log('[smoke] delete_workspace (only for A)...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'delete_workspace',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] list_lessons after delete (A expect 0)...');
  const listAfterResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'list_lessons',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          page: { limit: 20 },
        },
      },
    },
    CallToolResultSchema,
  );
  const listAfterJsonA = extractFirstTextJson(listAfterResultA);
  const lessonsCountAfterA = listAfterJsonA.items?.length ?? 0;
  console.log('[smoke] lessons after delete (A):', lessonsCountAfterA);
  if (lessonsCountAfterA !== 0) {
    throw new Error(`delete_workspace did not fully clear lessons for projectIdA=${projectIdA}`);
  }

  console.log('[smoke] list_lessons after delete (B should remain >0)...');
  const listAfterResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'list_lessons',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          page: { limit: 20 },
        },
      },
    },
    CallToolResultSchema,
  );
  const listAfterJsonB = extractFirstTextJson(listAfterResultB);
  const lessonsCountAfterB = listAfterJsonB.items?.length ?? 0;
  console.log('[smoke] lessons after delete (B):', lessonsCountAfterB);
  if (lessonsCountAfterB === 0) {
    throw new Error(`delete_workspace incorrectly cleared lessons for projectIdB=${projectIdB}`);
  }

  console.log('[smoke] search_code after delete (A expect matches=0)...');
  const searchAfterResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchAfterJsonA = extractFirstTextJson(searchAfterResultA);
  const matchesAfterA = searchAfterJsonA.matches?.length ?? 0;
  console.log('[smoke] matches after delete (A):', matchesAfterA);
  if (matchesAfterA !== 0) {
    throw new Error(`delete_workspace did not fully clear chunks for projectIdA=${projectIdA}`);
  }

  console.log('[smoke] search_code after delete (B should remain >0)...');
  const searchAfterResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchAfterJsonB = extractFirstTextJson(searchAfterResultB);
  const matchesAfterB = searchAfterJsonB.matches?.length ?? 0;
  console.log('[smoke] matches after delete (B):', matchesAfterB);
  if (matchesAfterB === 0) {
    throw new Error(`delete_workspace incorrectly cleared chunks for projectIdB=${projectIdB}`);
  }

  await transport.close();
  console.log('[smoke] done');
}

main().catch((err: any) => {
  console.error('[smoke] failed:', err instanceof McpError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
});

