import { sha256Hex } from '../utils/hash.js';

/** Normalize repo-relative paths to forward slashes for stable IDs. */
export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function makeFileGraphId(projectId: string, filePathRel: string): string {
  const p = normalizeRepoPath(filePathRel);
  return sha256Hex(`${projectId}|${p}`);
}

export function makeSymbolGraphId(projectId: string, filePathRel: string, fqn: string, signature: string): string {
  const p = normalizeRepoPath(filePathRel);
  return sha256Hex(`${projectId}|${p}|${fqn}|${signature}`);
}
