import { it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addComponent } from "../src/add-component.ts";

const retired = ["discord-bot", "telegram-bot", "electron-app", "react-native", "cloudflare-pages"];
const bin = resolve(import.meta.dirname, "../dist/index.js");

it("the built CLI lists public templates and rejects retired generation without creating a project", () => {
  const cwd = mkdtempSync(join(tmpdir(), "template-availability-"));
  try {
    const listed = spawnSync(process.execPath, [bin, "--list"], { cwd, encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /docker-deploy/);
    for (const id of retired) {
      assert.ok(!listed.stdout.includes(id), `${id} must not be advertised`);
      const result = spawnSync(process.execPath, [bin, "new-project", "--template", id], { cwd, encoding: "utf8" });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /no longer available for downloads/);
      assert.equal(existsSync(join(cwd, "new-project")), false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("explicit retired component sources fail before fetching", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "component-availability-"));
  let fetched = false;
  try {
    for (const starter of retired) {
      await assert.rejects(() => addComponent(cwd, {
        starter,
        fetchOptions: { fetchImpl: (async () => {
          fetched = true;
          throw new Error("must not fetch");
        }) as typeof fetch },
      }), /no longer available for downloads/);
    }
    assert.equal(fetched, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
