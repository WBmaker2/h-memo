import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import {
  VITEST_EXCLUDE_PATTERNS,
  VITEST_INCLUDE_PATTERNS,
} from "./scripts/lib/vitest-boundaries.js";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: VITEST_INCLUDE_PATTERNS,
    exclude: VITEST_EXCLUDE_PATTERNS,
  }
});
