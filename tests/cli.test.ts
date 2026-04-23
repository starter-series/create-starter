import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/cli.ts";

describe("parseCliArgs", () => {
  it("parses a minimal create invocation", () => {
    const parsed = parseCliArgs(["my-bot", "--template", "discord-bot"]);
    assert.deepEqual(parsed.positionals, ["my-bot"]);
    assert.equal(parsed.values.template, "discord-bot");
  });

  it("supports short flags", () => {
    const parsed = parseCliArgs([
      "my-bot",
      "-t",
      "discord-bot",
      "-d",
      "bot desc",
      "-o",
      "out/dir",
    ]);
    assert.equal(parsed.values.template, "discord-bot");
    assert.equal(parsed.values.description, "bot desc");
    assert.equal(parsed.values["output-dir"], "out/dir");
  });

  it("supports --list without a positional", () => {
    const parsed = parseCliArgs(["--list"]);
    assert.equal(parsed.values.list, true);
    assert.deepEqual(parsed.positionals, []);
  });

  it("supports --help / --version booleans", () => {
    assert.equal(parseCliArgs(["-h"]).values.help, true);
    assert.equal(parseCliArgs(["--help"]).values.help, true);
    assert.equal(parseCliArgs(["-v"]).values.version, true);
    assert.equal(parseCliArgs(["--version"]).values.version, true);
  });

  it("supports --no-git boolean", () => {
    const parsed = parseCliArgs(["my-app", "-t", "mcp-server", "--no-git"]);
    assert.equal(parsed.values["no-git"], true);
  });

  it("rejects unknown options", () => {
    assert.throws(() => parseCliArgs(["my-app", "--bogus"]));
  });
});
