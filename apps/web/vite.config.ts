import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import {
  VITEST_EXCLUDE_PATTERNS,
  VITEST_INCLUDE_PATTERNS,
} from "../../scripts/lib/vitest-boundaries.js";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: process.env.H_MEMO_WEB_BASE_PATH ?? (isGitHubPages ? "/h-memo/" : "/"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("../../vitest.setup.ts", import.meta.url))],
    include: VITEST_INCLUDE_PATTERNS,
    exclude: VITEST_EXCLUDE_PATTERNS,
  },
});
