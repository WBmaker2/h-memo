import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  base: process.env.H_MEMO_WEB_BASE_PATH ?? (isGitHubPages ? "/h-memo/" : "/"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../../vitest.setup.ts"],
  },
});
