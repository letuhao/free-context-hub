import fs from 'node:fs';
import path from 'node:path';
import {
  type CallExpression,
  type ClassDeclaration,
  type Expression,
  type HeritageClause,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type PropertyAccessExpression,
  type SourceFile,
  Project,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'ts-morph';

import { normalizeRepoPath } from '../ids.js';

export type GraphSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'method'
  | 'namespace'
  | 'constructor'
  | 'unknown';

export type ExtractedSymbol = {
  name: string;
  kind: GraphSymbolKind;
  fqn: string;
  signature: string;
};

export type ExtractedEdge =
  | { type: 'IMPORTS'; target_file_rel: string; specifier: string }
  | { type: 'CALLS'; from_fqn: string; to_fqn: string }
  | { type: 'EXTENDS'; from_fqn: string; to_fqn: string }
  | { type: 'IMPLEMENTS'; from_fqn: string; to_fqn: string };

export type ExtractedFileGraph = {
  symbols: ExtractedSymbol[];
  edges: ExtractedEdge[];
};

function truncateSig(s: string, max = 512): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function buildFqn(fileRel: string, parts: string[]): string {
  return `${normalizeRepoPath(fileRel)}::${parts.filter(Boolean).join('.')}`;
}

function resolveModuleSpecifier(fromDir: string, spec: string): string | null {
  const s = spec.trim();
  if (!s || s.startsWith('@/')) return null; // skip path aliases without tsconfig
  if (s.startsWith('node:') || (!s.startsWith('.') && !s.startsWith('/'))) {
    return null; // external / bare
  }

  const abs = path.normalize(path.join(fromDir, s));
  const candidates = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    `${abs}.js`,
    `${abs}.jsx`,
    `${abs}.mjs`,
    `${abs}.cjs`,
    path.join(abs, 'index.ts'),
    path.join(abs, 'index.tsx'),
    path.join(abs, 'index.js'),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function toRepoRel(absPath: string, root: string): string {
  return normalizeRepoPath(path.relative(root, absPath));
}

function getCalleeName(expr: Expression | undefined): string | null {
  if (!expr) return null;
  if (expr.getKind() === SyntaxKind.Identifier) {
    return (expr as Identifier).getText();
  }
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    return (expr as PropertyAccessExpression).getName();
  }
  return null;
}

function collectDeclaredFqnsForFile(sf: SourceFile, fileRel: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const decl of sf.getFunctions()) {
    const name = decl.getName();
    if (!name) continue;
    const fqn = buildFqn(fileRel, [name]);
    map.set(name, fqn);
  }

  for (const decl of sf.getClasses()) {
    const cname = decl.getName();
    if (!cname) continue;
    const classParts = [cname];
    map.set(cname, buildFqn(fileRel, classParts));

    for (const m of decl.getMethods()) {
      const mn = m.getName();
      const mfqn = buildFqn(fileRel, [...classParts, mn]);
      map.set(`${cname}.${mn}`, mfqn);
    }

    for (const c of decl.getConstructors()) {
      const mfqn = buildFqn(fileRel, [...classParts, 'constructor']);
      map.set(`${cname}.constructor`, mfqn);
    }
  }

  for (const decl of sf.getInterfaces()) {
    const name = decl.getName();
    map.set(name, buildFqn(fileRel, [name]));
  }

  for (const decl of sf.getTypeAliases()) {
    const name = decl.getName();
    map.set(name, buildFqn(fileRel, [name]));
  }

  for (const decl of sf.getEnums()) {
    const name = decl.getName();
    map.set(name, buildFqn(fileRel, [name]));
  }

  // Top-level const/let (best-effort)
  for (const stmt of sf.getVariableStatements()) {
    for (const d of stmt.getDeclarations()) {
      const name = d.getName();
      map.set(name, buildFqn(fileRel, [name]));
    }
  }

  return map;
}

function extractHeritageEdges(cls: ClassDeclaration, fileRel: string, edges: ExtractedEdge[]) {
  const from = cls.getName();
  if (!from) return;
  const fromFqn = buildFqn(fileRel, [from]);

  for (const h of cls.getHeritageClauses()) {
    const token = h.getToken();
    const isExtends = token === SyntaxKind.ExtendsKeyword;
    const isImplements = token === SyntaxKind.ImplementsKeyword;

    for (const t of h.getTypeNodes()) {
      const text = t.getText();
      const target = text.split(/[\.<]/)[0]?.trim();
      if (!target) continue;
      const toFqn = buildFqn(fileRel, [target]);
      if (isExtends) {
        edges.push({ type: 'EXTENDS', from_fqn: fromFqn, to_fqn: toFqn });
      } else if (isImplements) {
        edges.push({ type: 'IMPLEMENTS', from_fqn: fromFqn, to_fqn: toFqn });
      }
    }
  }
}

export function extractTsMorphFileGraph(params: {
  projectId: string;
  rootAbs: string;
  fileRel: string;
  fileAbs: string;
}): ExtractedFileGraph | null {
  const { rootAbs, fileRel, fileAbs } = params;
  const ext = path.extname(fileAbs).toLowerCase();
  const allowed = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  if (!allowed.has(ext)) return null;

  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ES2022,
      allowJs: true,
      checkJs: false,
      jsx: ext === '.tsx' || ext === '.jsx' ? 4 : undefined,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });

  const scriptKind =
    ext === '.tsx' || ext === '.jsx'
      ? ScriptKind.TSX
      : ext === '.js' || ext === '.jsx'
        ? ScriptKind.JS
        : ScriptKind.TS;

  let sf: SourceFile;
  try {
    sf = project.createSourceFile(fileAbs, fs.readFileSync(fileAbs, 'utf8'), {
      overwrite: true,
      scriptKind,
    });
  } catch {
    return null;
  }

  const symbols: ExtractedSymbol[] = [];
  const edges: ExtractedEdge[] = [];

  const pushSymbol = (name: string, kind: GraphSymbolKind, fqn: string, signature: string) => {
    symbols.push({
      name,
      kind,
      fqn,
      signature: truncateSig(signature),
    });
  };

  const fromDir = path.dirname(fileAbs);

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const resolved = resolveModuleSpecifier(fromDir, spec);
    if (!resolved) continue;
    const targetRel = toRepoRel(resolved, rootAbs);
    if (targetRel.startsWith('..')) continue;
    edges.push({ type: 'IMPORTS', target_file_rel: targetRel, specifier: spec });
  }

  for (const decl of sf.getFunctions()) {
    const name = decl.getName();
    if (!name) continue;
    const fqn = buildFqn(fileRel, [name]);
    pushSymbol(name, 'function', fqn, decl.getSignature()?.getDeclaration()?.getText() ?? decl.getText());
  }

  for (const decl of sf.getClasses()) {
    const cname = decl.getName();
    if (!cname) continue;
    const classFqn = buildFqn(fileRel, [cname]);
    pushSymbol(cname, 'class', classFqn, decl.getText());

    extractHeritageEdges(decl, fileRel, edges);

    for (const m of decl.getMethods()) {
      const mn = m.getName();
      const mfqn = buildFqn(fileRel, [cname, mn]);
      pushSymbol(mn, 'method', mfqn, m.getText());
    }

    for (const c of decl.getConstructors()) {
      const mfqn = buildFqn(fileRel, [cname, 'constructor']);
      pushSymbol('constructor', 'constructor', mfqn, c.getText());
    }
  }

  for (const decl of sf.getInterfaces()) {
    const name = decl.getName();
    const fqn = buildFqn(fileRel, [name]);
    pushSymbol(name, 'interface', fqn, decl.getText());
  }

  for (const decl of sf.getTypeAliases()) {
    const name = decl.getName();
    const fqn = buildFqn(fileRel, [name]);
    pushSymbol(name, 'type', fqn, decl.getText());
  }

  for (const decl of sf.getEnums()) {
    const name = decl.getName();
    const fqn = buildFqn(fileRel, [name]);
    pushSymbol(name, 'enum', fqn, decl.getText());
  }

  for (const stmt of sf.getVariableStatements()) {
    for (const d of stmt.getDeclarations()) {
      const name = d.getName();
      const fqn = buildFqn(fileRel, [name]);
      pushSymbol(name, 'variable', fqn, d.getText());
    }
  }

  const localFqns = collectDeclaredFqnsForFile(sf, fileRel);

  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const callee = call.getExpression();
    const name = getCalleeName(callee);
    if (!name) return;

    // Find containing function/class method for caller
    const fnLike = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
      ?? call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
      ?? call.getFirstAncestorByKind(SyntaxKind.Constructor)
      ?? call.getFirstAncestorByKind(SyntaxKind.ArrowFunction);

    let fromFqn: string | null = null;
    if (fnLike) {
      if (fnLike.getKind() === SyntaxKind.FunctionDeclaration) {
        const n = (fnLike as any).getName?.();
        if (n) fromFqn = localFqns.get(n) ?? null;
      } else if (fnLike.getKind() === SyntaxKind.MethodDeclaration) {
        const cls = fnLike.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) as ClassDeclaration | undefined;
        const cname = cls?.getName();
        const mname = (fnLike as any).getName?.();
        if (cname && mname) fromFqn = localFqns.get(`${cname}.${mname}`) ?? null;
      } else if (fnLike.getKind() === SyntaxKind.Constructor) {
        const cls = fnLike.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) as ClassDeclaration | undefined;
        const cname = cls?.getName();
        if (cname) fromFqn = localFqns.get(`${cname}.constructor`) ?? null;
      }
    }

    const toFqn = localFqns.get(name) ?? null;
    if (fromFqn && toFqn) {
      edges.push({ type: 'CALLS', from_fqn: fromFqn, to_fqn: toFqn });
    }
  });

  // De-dupe symbols by fqn
  const seen = new Set<string>();
  const uniqSymbols = symbols.filter(s => {
    if (seen.has(s.fqn)) return false;
    seen.add(s.fqn);
    return true;
  });

  return { symbols: uniqSymbols, edges };
}
