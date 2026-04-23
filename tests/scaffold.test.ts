import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import {
  SAFE_NAME,
  validateOutputDir,
  validateProjectName,
} from "../src/scaffold.ts";

describe("validateProjectName", () => {
  it("accepts kebab-case / snake_case / mixed case starting with alnum", () => {
    assert.doesNotThrow(() => validateProjectName("my-app"));
    assert.doesNotThrow(() => validateProjectName("my_app"));
    assert.doesNotThrow(() => validateProjectName("MyApp"));
    assert.doesNotThrow(() => validateProjectName("my-app_123"));
    assert.doesNotThrow(() => validateProjectName("0-start"));
  });

  it("rejects names starting with '-' or '_' (breaks package.json publish)", () => {
    assert.throws(() => validateProjectName("-leading-dash"), /Invalid project name/);
    assert.throws(() => validateProjectName("_leading-underscore"), /Invalid project name/);
  });

  it("rejects whitespace", () => {
    assert.throws(() => validateProjectName("my app"), /Invalid project name/);
  });

  it("rejects dots", () => {
    assert.throws(() => validateProjectName("my.app"), /Invalid project name/);
  });

  it("rejects path-traversal attempts", () => {
    assert.throws(() => validateProjectName("../escape"), /Invalid project name/);
    assert.throws(() => validateProjectName("foo/bar"), /Invalid project name/);
    assert.throws(() => validateProjectName("/abs/path"), /Invalid project name/);
  });

  it("rejects shell / regex metacharacters", () => {
    for (const bad of ["my$app", "my;app", "my`app", "my|app", "my*app", "my(app)"]) {
      assert.throws(() => validateProjectName(bad), /Invalid project name/);
    }
  });

  it("rejects the empty string", () => {
    assert.throws(() => validateProjectName(""), /Invalid project name/);
  });
});

describe("SAFE_NAME regex", () => {
  it("matches what validateProjectName accepts", () => {
    assert.ok(SAFE_NAME.test("my-app"));
    assert.ok(!SAFE_NAME.test("my app"));
    assert.ok(!SAFE_NAME.test("my.app"));
    assert.ok(!SAFE_NAME.test("../escape"));
    assert.ok(!SAFE_NAME.test("-leading"));
  });
});

describe("validateOutputDir", () => {
  const CWD = `${sep}work${sep}projects`;

  it("defaults to <cwd>/<projectName> when outputDir is undefined", () => {
    assert.equal(
      validateOutputDir(undefined, "my-app", CWD),
      `${CWD}${sep}my-app`,
    );
  });

  it("accepts a simple relative subdir", () => {
    assert.equal(
      validateOutputDir("sub/my-app", "my-app", CWD),
      `${CWD}${sep}sub${sep}my-app`,
    );
  });

  it("rejects a relative path that escapes cwd via ..", () => {
    assert.throws(
      () => validateOutputDir("../escape", "my-app", CWD),
      /escapes the working directory/,
    );
    assert.throws(
      () => validateOutputDir("../../etc", "my-app", CWD),
      /escapes the working directory/,
    );
  });

  it("accepts absolute paths as explicit user intent", () => {
    const abs = `${sep}Users${sep}me${sep}code${sep}my-app`;
    assert.equal(validateOutputDir(abs, "my-app", CWD), abs);
  });

  it("normalizes relative paths correctly", () => {
    const result = validateOutputDir("./nested/./dir", "my-app", CWD);
    assert.equal(result, `${CWD}${sep}nested${sep}dir`);
  });
});
