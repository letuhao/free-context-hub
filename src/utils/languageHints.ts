/**
 * Language-aware search hints.
 * Given a detected language and query intent, generates additional
 * lexical tokens that help surface relevant code patterns.
 *
 * These are structural conventions per language, not project-specific.
 */

type IntentCategory =
  | 'definition'     // "where is X defined"
  | 'entrypoint'     // "main entry point", "server start"
  | 'export'         // "what does this module export"
  | 'import'         // "who imports X"
  | 'test'           // "tests for X"
  | 'config'         // "configuration", "settings"
  | 'route'          // "API endpoint", "route handler"
  | 'error'          // "error handling", "exception"
  | 'type'           // "type definition", "interface"
  ;

const INTENT_PATTERNS: Array<{ category: IntentCategory; pattern: RegExp }> = [
  { category: 'definition', pattern: /\b(defin|implement|declar|creat)\w*/i },
  { category: 'entrypoint', pattern: /\b(entry.?point|main|start|bootstrap|init)\b/i },
  { category: 'export', pattern: /\b(export|public.?api|module.?interface)\b/i },
  { category: 'import', pattern: /\b(import|require|depend|use[sd]?\s+by)\b/i },
  { category: 'test', pattern: /\b(test|spec|assert|expect|mock)\b/i },
  { category: 'config', pattern: /\b(config|setting|env|option|parameter)\b/i },
  { category: 'route', pattern: /\b(route|endpoint|handler|controller|api|request|response)\b/i },
  { category: 'error', pattern: /\b(error|exception|throw|catch|fail|panic)\b/i },
  { category: 'type', pattern: /\b(type|interface|struct|schema|model|entity)\b/i },
];

type LanguageHints = Partial<Record<IntentCategory, string[]>>;

const HINTS: Record<string, LanguageHints> = {
  typescript: {
    definition: ['export function', 'export class', 'export const'],
    entrypoint: ['index.ts', 'main.ts', 'app.ts', 'server.ts'],
    export: ['export', 'module.exports'],
    import: ['import', 'from', 'require'],
    test: ['.test.ts', '.spec.ts', 'describe(', 'it(', 'expect('],
    config: ['env', 'config', '.env', 'process.env'],
    route: ['app.get', 'app.post', 'router.', 'express', 'handler'],
    error: ['throw new', 'catch', 'Error(', 'reject'],
    type: ['interface', 'type ', 'enum'],
  },
  javascript: {
    definition: ['function', 'class', 'const', 'module.exports'],
    entrypoint: ['index.js', 'main.js', 'app.js', 'server.js'],
    export: ['export', 'module.exports', 'exports.'],
    import: ['import', 'require(', 'from'],
    test: ['.test.js', '.spec.js', 'describe(', 'it(', 'expect('],
    config: ['env', 'config', 'process.env', '.env'],
    route: ['app.get', 'app.post', 'router.', 'express'],
    error: ['throw', 'catch', 'Error(', 'reject'],
    type: ['@typedef', '@param', 'PropTypes'],
  },
  python: {
    definition: ['def ', 'class '],
    entrypoint: ['__main__', 'main.py', 'app.py', 'wsgi.py', 'asgi.py'],
    export: ['__all__', 'def ', 'class '],
    import: ['import ', 'from '],
    test: ['test_', '_test.py', 'pytest', 'unittest', 'assert'],
    config: ['settings.py', 'config.py', '.env', 'environ'],
    route: ['@app.route', '@router', 'path(', 'url(', 'endpoint'],
    error: ['raise ', 'except ', 'Exception', 'try:'],
    type: ['dataclass', 'TypedDict', 'BaseModel', 'Protocol'],
  },
  go: {
    definition: ['func ', 'type '],
    entrypoint: ['func main(', 'main.go', 'cmd/'],
    export: ['func ', 'type '], // Go: uppercase = exported
    import: ['import (', 'import "'],
    test: ['_test.go', 'func Test', 'func Benchmark', 't.Run'],
    config: ['config.go', 'env', 'flag.', 'viper'],
    route: ['HandleFunc', 'Handle(', 'Router', 'http.', 'gin.'],
    error: ['error', 'fmt.Errorf', 'errors.New', 'panic'],
    type: ['struct {', 'interface {', 'type '],
  },
  rust: {
    definition: ['fn ', 'struct ', 'enum ', 'trait ', 'impl '],
    entrypoint: ['fn main(', 'main.rs', 'lib.rs'],
    export: ['pub fn', 'pub struct', 'pub enum', 'pub mod'],
    import: ['use ', 'mod ', 'extern crate'],
    test: ['#[test]', '#[cfg(test)]', 'assert!', 'assert_eq!'],
    config: ['config', 'env', 'dotenv', 'Settings'],
    route: ['#[get', '#[post', 'Router', 'handler', 'axum', 'actix'],
    error: ['Result<', 'Error', 'anyhow', 'thiserror', 'panic!', '?;'],
    type: ['struct ', 'enum ', 'trait ', 'type '],
  },
  java: {
    definition: ['class ', 'interface ', 'enum '],
    entrypoint: ['public static void main', 'Application.java', '@SpringBootApplication'],
    export: ['public class', 'public interface'],
    import: ['import '],
    test: ['@Test', 'Test.java', 'assertEquals', 'assertThat', 'Mockito'],
    config: ['@Configuration', '@Value', 'application.properties', 'application.yml'],
    route: ['@GetMapping', '@PostMapping', '@RequestMapping', '@RestController', '@Controller'],
    error: ['throw new', 'catch (', 'Exception', 'try {'],
    type: ['class ', 'interface ', 'enum ', '@Data'],
  },
  kotlin: {
    definition: ['fun ', 'class ', 'object '],
    entrypoint: ['fun main(', 'Application.kt', '@SpringBootApplication'],
    export: ['fun ', 'class ', 'object '],
    import: ['import '],
    test: ['@Test', 'Test.kt', 'assertEquals', 'assertThat'],
    config: ['@Configuration', '@Value', 'application.properties'],
    route: ['@GetMapping', '@PostMapping', '@RequestMapping'],
    error: ['throw ', 'catch ', 'Exception', 'try {'],
    type: ['data class', 'sealed class', 'interface ', 'enum class'],
  },
  ruby: {
    definition: ['def ', 'class ', 'module '],
    entrypoint: ['config.ru', 'app.rb', 'application.rb'],
    export: ['def ', 'class ', 'module '],
    import: ['require ', "require_relative"],
    test: ['_test.rb', '_spec.rb', 'describe ', 'it ', 'expect('],
    config: ['config/', 'initializers/', '.env', 'ENV['],
    route: ['get ', 'post ', 'resources ', 'routes.rb'],
    error: ['raise ', 'rescue ', 'begin', 'StandardError'],
    type: ['class ', 'module ', 'Struct.new'],
  },
  csharp: {
    definition: ['class ', 'interface ', 'struct '],
    entrypoint: ['Program.cs', 'Startup.cs', 'static void Main'],
    export: ['public class', 'public interface'],
    import: ['using '],
    test: ['[Test]', '[Fact]', '[Theory]', 'Assert.'],
    config: ['appsettings.json', 'IConfiguration', '[Configuration]'],
    route: ['[HttpGet]', '[HttpPost]', '[Route]', '[ApiController]', 'MapGet', 'MapPost'],
    error: ['throw new', 'catch (', 'Exception', 'try {'],
    type: ['class ', 'interface ', 'struct ', 'record ', 'enum '],
  },
  php: {
    definition: ['function ', 'class '],
    entrypoint: ['index.php', 'app.php', 'bootstrap'],
    export: ['function ', 'class '],
    import: ['use ', 'require ', 'include '],
    test: ['Test.php', 'test_', 'PHPUnit', 'assert'],
    config: ['config/', '.env', 'env('],
    route: ['Route::', '@route', 'get(', 'post('],
    error: ['throw new', 'catch (', 'Exception', 'try {'],
    type: ['class ', 'interface ', 'enum ', 'trait '],
  },
  swift: {
    definition: ['func ', 'class ', 'struct ', 'protocol '],
    entrypoint: ['@main', 'AppDelegate', 'main.swift'],
    export: ['public func', 'public class', 'open class'],
    import: ['import '],
    test: ['XCTestCase', 'func test', 'XCTAssert'],
    config: ['Info.plist', 'Configuration', 'Environment'],
    route: ['path:', 'router.', 'Route'],
    error: ['throw ', 'catch ', 'Error', 'do {'],
    type: ['struct ', 'protocol ', 'class ', 'enum '],
  },
};

/**
 * Detect query intent categories.
 */
function detectIntents(query: string): IntentCategory[] {
  const intents: IntentCategory[] = [];
  for (const { category, pattern } of INTENT_PATTERNS) {
    if (pattern.test(query)) intents.push(category);
  }
  return intents;
}

/**
 * Generate language-aware search tokens for a query.
 * @param query    - The user's search query.
 * @param language - Detected language of the file/project (lowercase).
 * @returns Additional tokens to boost lexical matching.
 */
export function getLanguageSearchHints(query: string, language: string): string[] {
  const hints = HINTS[language];
  if (!hints) return [];

  const intents = detectIntents(query);
  if (intents.length === 0) return [];

  const tokens: string[] = [];
  for (const intent of intents) {
    const intentHints = hints[intent];
    if (intentHints) tokens.push(...intentHints);
  }

  return Array.from(new Set(tokens)).slice(0, 8);
}

/**
 * Get the dominant language for a project from chunk metadata.
 * Returns the most common language in the chunk set.
 */
export async function getProjectDominantLanguage(
  pool: { query: (sql: string, params: any[]) => Promise<any> },
  projectId: string,
): Promise<string | null> {
  const res = await pool.query(
    `SELECT language, COUNT(*) as cnt
     FROM chunks
     WHERE project_id = $1 AND language IS NOT NULL
     GROUP BY language
     ORDER BY cnt DESC
     LIMIT 1;`,
    [projectId],
  );
  return res.rows?.[0]?.language ?? null;
}
