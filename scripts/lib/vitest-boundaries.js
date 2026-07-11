const EXCLUDED_DIRECTORY_NAMES = [
  "node_modules",
  "dist",
  "dist-ssr",
  "coverage",
  ".worktrees",
  "target",
];

export const VITEST_INCLUDE_PATTERNS = [
  "**/*.{test,spec}.{js,mjs,cjs,ts,tsx}",
];

export const VITEST_EXCLUDE_PATTERNS = EXCLUDED_DIRECTORY_NAMES.map(
  (directoryName) => `**/${directoryName}/**`
);

export function isVitestExcludedPath(pathname) {
  return pathname
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => EXCLUDED_DIRECTORY_NAMES.includes(segment));
}
