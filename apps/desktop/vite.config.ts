import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { UserConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  clearScreen: false,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["../../vitest.setup.ts"]
  }
} as UserConfig & {
  test: {
    environment: string;
    globals: boolean;
    setupFiles: string[];
  };
});
