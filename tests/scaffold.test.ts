import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SAFE_NAME, validateProjectName } from "../src/scaffold.ts";

describe("validateProjectName", () => {
  it("accepts a simple kebab-case name", () => {
    assert.doesNotThrow(() => validateProjectName("my-app"));
  });

  it("accepts snake_case and mixed case", () => {
    assert.doesNotThrow(() => validateProjectName("my_app"));
    assert.doesNotThrow(() => validateProjectName("MyApp"));
    assert.doesNotThrow(() => validateProjectName("my-app_123"));
  });

  it("rejects names containing whitespace", () => {
    assert.throws(() => validateProjectName("my app"), /Invalid project name/);
  });

  it("rejects names containing dots", () => {
    assert.throws(() => validateProjectName("my.app"), /Invalid project name/);
  });

  it("rejects path-traversal attempts", () => {
    assert.throws(() => validateProjectName("../escape"), /Invalid project name/);
    assert.throws(() => validateProjectName("foo/bar"), /Invalid project name/);
    assert.throws(() => validateProjectName("/abs/path"), /Invalid project name/);
  });

  it("rejects shell/regex metacharacters", () => {
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
  });
});
