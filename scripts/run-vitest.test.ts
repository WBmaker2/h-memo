import { describe, expect, it } from "vitest";

import { buildNodeOptions } from "./run-vitest.mjs";

describe("run-vitest", () => {
  it("disables Node experimental WebStorage while preserving other NODE_OPTIONS", () => {
    const options = buildNodeOptions(
      "--trace-warnings --experimental-webstorage --max-old-space-size=4096"
    );

    expect(options).toContain("--trace-warnings");
    expect(options).toContain("--max-old-space-size=4096");
    expect(options).not.toContain("--experimental-webstorage");
    expect(options).not.toContain("--webstorage");

    if (process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")) {
      expect(options).toContain("--no-experimental-webstorage");
    }
  });

  it("removes the Node localStorage file flag from inherited workspace options", () => {
    const options = buildNodeOptions(
      "--trace-warnings --localstorage-file=/tmp/h-memo-vitest-storage --max-old-space-size=4096"
    );

    expect(options).toContain("--trace-warnings");
    expect(options).toContain("--max-old-space-size=4096");
    expect(options).not.toContain("--localstorage-file");
  });
});
