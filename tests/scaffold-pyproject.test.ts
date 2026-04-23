import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updatePyproject } from "../src/scaffold.ts";

describe("updatePyproject", () => {
  let workDir: string;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), "create-starter-test-"));
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const names = {
    defaultName: "my-mcp-server",
    projectName: "cool-tool",
    defaultSnake: "my_mcp_server",
    projectSnake: "cool_tool",
  };

  it("renames [project] name to the new project name", () => {
    const pyPath = join(workDir, "name.toml");
    writeFileSync(
      pyPath,
      `[project]
name = "my-mcp-server"
version = "0.1.0"
`,
      "utf-8",
    );
    updatePyproject(pyPath, names);
    const out = readFileSync(pyPath, "utf-8");
    assert.match(out, /^name = "cool-tool"$/m);
    assert.doesNotMatch(out, /"my-mcp-server"/);
  });

  it("rewrites packages entries for the wheel target", () => {
    const pyPath = join(workDir, "packages.toml");
    writeFileSync(
      pyPath,
      `[project]
name = "my-mcp-server"

[tool.hatch.build.targets.wheel]
packages = ["src/my_mcp_server"]
`,
      "utf-8",
    );
    updatePyproject(pyPath, names);
    const out = readFileSync(pyPath, "utf-8");
    assert.match(out, /packages = \["src\/cool_tool"\]/);
    assert.doesNotMatch(out, /src\/my_mcp_server/);
  });

  it("handles single-quoted package paths", () => {
    const pyPath = join(workDir, "singlequote.toml");
    writeFileSync(
      pyPath,
      `[tool.hatch.build.targets.wheel]
packages = ['src/my_mcp_server']
`,
      "utf-8",
    );
    updatePyproject(pyPath, names);
    const out = readFileSync(pyPath, "utf-8");
    assert.match(out, /'src\/cool_tool'/);
  });

  it("only rewrites the name line if it matches the default name", () => {
    // If a template sub-section has its own `name = "..."` that is not the
    // project's canonical name, the first-match-only regex must not touch
    // anything. We verify by giving a pyproject whose first name line already
    // differs from defaultName.
    const pyPath = join(workDir, "other-name.toml");
    const original = `[project]
name = "something-else"
version = "0.1.0"
`;
    writeFileSync(pyPath, original, "utf-8");
    updatePyproject(pyPath, names);
    const out = readFileSync(pyPath, "utf-8");
    assert.equal(out, original);
  });

  it("is a no-op when pyproject.toml does not exist", () => {
    // Should not throw on missing file.
    assert.doesNotThrow(() =>
      updatePyproject(join(workDir, "nonexistent.toml"), names),
    );
  });

  it("keeps [project] name and packages consistent after a full rewrite", () => {
    const pyPath = join(workDir, "full.toml");
    writeFileSync(
      pyPath,
      `[project]
name = "my-mcp-server"
version = "0.1.0"
description = "demo"

[tool.hatch.build.targets.wheel]
packages = ["src/my_mcp_server"]
`,
      "utf-8",
    );
    updatePyproject(pyPath, names);
    const out = readFileSync(pyPath, "utf-8");
    assert.match(out, /^name = "cool-tool"$/m);
    assert.match(out, /packages = \["src\/cool_tool"\]/);
    assert.doesNotMatch(out, /my-mcp-server/);
    assert.doesNotMatch(out, /my_mcp_server/);
  });
});
