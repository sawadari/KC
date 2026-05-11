import { minimatch } from "minimatch";

export function normalizeRepoPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function matchesAny(filePath: string, patterns: string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizeRepoPath(pattern);
    return minimatch(normalized, normalizedPattern, { dot: true }) || normalized === normalizedPattern;
  });
}

export function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizeRepoPath).filter(Boolean))].sort();
}

