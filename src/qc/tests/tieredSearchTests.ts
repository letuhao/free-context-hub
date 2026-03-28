import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';
import { normalizePath } from '../goldenTypes.js';

const GROUP = 'tiered-search' as const;

/**
 * Test 8: Profile auto-selection based on kind parameter
 */
export const profileSelection: TestFn = async (ctx) => {
  const name = 'profile-selection';
  const start = Date.now();

  try {
    const cases: Array<{ kind: any; expected: string; label: string }> = [
      { kind: 'source', expected: 'code-search', label: 'kind=source' },
      { kind: 'test', expected: 'relationship', label: 'kind=test' },
      { kind: 'doc', expected: 'semantic-first', label: 'kind=doc' },
      { kind: ['source', 'test'], expected: 'code-search', label: 'kind=[source,test] (mixed)' },
      { kind: undefined, expected: 'code-search', label: 'kind=undefined (default)' },
    ];

    for (const c of cases) {
      const args: Record<string, unknown> = {
        project_id: ctx.projectId,
        query: 'auth',
        output_format: 'json_only',
      };
      if (c.kind !== undefined) args.kind = c.kind;

      const result = await callTool(ctx.client, 'search_code_tiered', withAuth(args, ctx.workspaceToken));
      if (result?.search_profile !== c.expected) {
        return fail(name, GROUP, Date.now() - start,
          `${c.label}: expected profile '${c.expected}', got '${result?.search_profile}'`);
      }
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 9: Code-search regression — identifier query finds expected file
 */
export const codeSearchRegression: TestFn = async (ctx) => {
  const name = 'code-search-regression';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'assertWorkspaceToken',
      kind: 'source',
      output_format: 'json_only',
    }, ctx.workspaceToken));

    const files = (result?.files ?? []) as Array<{ path: string; tier: string }>;
    const paths = files.map((f: any) => normalizePath(f.path));
    const found = paths.some(p => p.includes('src/index.ts') || p.endsWith('index.ts'));

    if (!found) {
      return fail(name, GROUP, Date.now() - start,
        `Expected src/index.ts in results for 'assertWorkspaceToken'. Got ${paths.length} files: ${paths.slice(0, 5).join(', ')}`);
    }

    // Verify it was found by a deterministic tier (not semantic).
    const indexFile = files.find((f: any) => normalizePath(f.path).includes('index.ts'));
    if (indexFile && indexFile.tier === 'semantic') {
      return fail(name, GROUP, Date.now() - start,
        `src/index.ts found but via semantic tier — expected deterministic (exact_match or symbol_match)`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 10: Relationship profile finds test files by convention
 */
export const relationshipProfile: TestFn = async (ctx) => {
  const name = 'relationship-profile';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'gitCommitFileParse',
      kind: 'test',
      output_format: 'json_only',
    }, ctx.workspaceToken));

    if (result?.search_profile !== 'relationship') {
      return fail(name, GROUP, Date.now() - start,
        `Expected 'relationship' profile, got '${result?.search_profile}'`);
    }

    const files = (result?.files ?? []) as Array<{ path: string; tier: string }>;
    const paths = files.map((f: any) => normalizePath(f.path));
    const foundTestFile = paths.some(p =>
      p.includes('gitCommitFileParse.test') || p.includes('gitCommitFileParse.spec')
    );

    if (!foundTestFile) {
      return fail(name, GROUP, Date.now() - start,
        `Expected gitCommitFileParse.test.ts in results. Got ${paths.length} files: ${paths.slice(0, 5).join(', ')}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 11: Semantic-first profile prioritizes semantic tier for docs
 */
export const semanticFirstProfile: TestFn = async (ctx) => {
  const name = 'semantic-first-profile';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'how does the project architecture work',
      kind: 'doc',
      output_format: 'json_only',
    }, ctx.workspaceToken));

    if (result?.search_profile !== 'semantic-first') {
      return fail(name, GROUP, Date.now() - start,
        `Expected 'semantic-first' profile, got '${result?.search_profile}'`);
    }

    const files = (result?.files ?? []) as Array<{ path: string; tier: string; kind: string }>;
    if (files.length === 0) {
      return fail(name, GROUP, Date.now() - start, 'No results returned for doc search');
    }

    // Top result should be semantic tier (semantic-first profile).
    if (files[0].tier !== 'semantic' && files[0].tier !== 'fts_match') {
      return fail(name, GROUP, Date.now() - start,
        `Expected first result to be semantic or fts tier, got '${files[0].tier}'`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 12: Kind filter accuracy — source excludes .md, doc excludes .ts source
 */
export const kindFilterAccuracy: TestFn = async (ctx) => {
  const name = 'kind-filter-accuracy';
  const start = Date.now();

  try {
    // kind=source should not return .md files.
    const sourceResult = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'auth',
      kind: 'source',
      max_files: 20,
      output_format: 'json_only',
    }, ctx.workspaceToken));

    const sourceFiles = (sourceResult?.files ?? []) as Array<{ path: string; kind: string }>;
    const mdInSource = sourceFiles.filter((f: any) => f.kind === 'doc' || normalizePath(f.path).endsWith('.md'));
    if (mdInSource.length > 0) {
      return fail(name, GROUP, Date.now() - start,
        `kind=source returned doc files: ${mdInSource.map((f: any) => f.path).join(', ')}`);
    }

    // kind=doc should not return .ts source files.
    const docResult = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'auth',
      kind: 'doc',
      max_files: 20,
      output_format: 'json_only',
    }, ctx.workspaceToken));

    const docFiles = (docResult?.files ?? []) as Array<{ path: string; kind: string }>;
    const tsInDoc = docFiles.filter((f: any) => f.kind === 'source');
    if (tsInDoc.length > 0) {
      return fail(name, GROUP, Date.now() - start,
        `kind=doc returned source files: ${tsInDoc.map((f: any) => f.path).join(', ')}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 13: includeTests auto-enabled when kind=test
 */
export const includeTestsAuto: TestFn = async (ctx) => {
  const name = 'include-tests-auto';
  const start = Date.now();

  try {
    // kind=test should return test files (auto-enabled).
    const testResult = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'parse',
      kind: 'test',
      output_format: 'json_only',
    }, ctx.workspaceToken));

    const testFiles = (testResult?.files ?? []) as Array<{ path: string; kind: string }>;
    const hasTestFiles = testFiles.some((f: any) => f.kind === 'test');
    // It's OK if no test files match 'parse' — but the response should NOT have non-test files.
    const nonTestFiles = testFiles.filter((f: any) => f.kind !== 'test');
    if (nonTestFiles.length > 0) {
      return fail(name, GROUP, Date.now() - start,
        `kind=test returned non-test files: ${nonTestFiles.map((f: any) => f.path).join(', ')}`);
    }

    // No kind filter — test files should be excluded by default.
    const defaultResult = await callTool(ctx.client, 'search_code_tiered', withAuth({
      project_id: ctx.projectId,
      query: 'parse',
      max_files: 30,
      output_format: 'json_only',
    }, ctx.workspaceToken));

    const defaultFiles = (defaultResult?.files ?? []) as Array<{ path: string; kind: string }>;
    const testInDefault = defaultFiles.filter((f: any) => f.kind === 'test');
    if (testInDefault.length > 0) {
      return fail(name, GROUP, Date.now() - start,
        `Default search (no kind) included test files: ${testInDefault.map((f: any) => f.path).join(', ')}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allTieredSearchTests: TestFn[] = [
  profileSelection,
  codeSearchRegression,
  relationshipProfile,
  semanticFirstProfile,
  kindFilterAccuracy,
  includeTestsAuto,
];
