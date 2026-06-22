import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

describe("package scripts", () => {
  it("builds dist before running the default test suite", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };

    assert.match(
      pkg.scripts.test,
      /^npm run build && /,
      "npm test must be runnable from a clean checkout without pre-existing dist output",
    );
  });
});
