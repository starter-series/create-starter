import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { create as createTar } from "tar";
import {
  addComponent,
  COMPONENT_GROUPS,
  formatAddComponentReport,
} from "../src/add-component.ts";

const STARTER_FILES: Record<string, string> = {
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/workflows/codeql.yml": "name: CodeQL\n",
  "SECURITY.md": "# Security\n",
  ".github/dependabot.yml": "version: 2\n",
  ".github/workflows/dependabot-auto-merge.yml": "name: automerge\n",
  ".github/workflows/maintenance.yml": "name: maintenance\n",
  ".github/workflows/stale.yml": "name: stale\n",
  // Present in real starters but never lifted — proves the allowlist holds.
  ".github/workflows/cd.yml": "name: CD\n",
  "src/index.js": "// app code\n",
};

async function packStarter(files: Record<string, string>): Promise<Buffer> {
  const root = mkdtempSync(join(tmpdir(), "ac-starter-"));
  const wrapper = "starter-main";
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, wrapper, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createTar({ cwd: root, gzip: true, portable: true }, [wrapper]);
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  rmSync(root, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

function fakeFetch(tarball: Buffer): typeof fetch {
  return (async () =>
    new Response(new Uint8Array(tarball), {
      status: 200,
      headers: { "content-length": String(tarball.length) },
    })) as unknown as typeof fetch;
}

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", ...args], {
    cwd: dir,
    stdio: "ignore",
  });
}

/** A target repo that detection maps to discord-bot (discord.js dependency). */
function makeRepo(opts: { gitInit?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ac-repo-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", dependencies: { "discord.js": "^14.0.0" } }),
  );
  if (opts.gitInit !== false) {
    git(dir, ["init", "-q"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "init"]);
  }
  return dir;
}

describe("addComponent — planning (dry-run default)", () => {
  it("plans create for every component file and writes nothing", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const r = await addComponent(repo, {
        starter: "discord-bot",
        fetchOptions: { fetchImpl: fakeFetch(tarball) },
      });
      assert.equal(r.dryRun, true);
      assert.equal(r.starterSource, "explicit");
      assert.equal(r.component, "all");
      const allFiles = Object.values(COMPONENT_GROUPS).flat();
      assert.equal(r.plan.length, allFiles.length);
      for (const entry of r.plan) assert.equal(entry.action, "create");
      assert.deepEqual(r.written, []);
      assert.equal(existsSync(join(repo, ".github/workflows/ci.yml")), false);
      // The allowlist never includes CD or app code.
      assert.ok(!r.plan.some((p) => p.path.includes("cd.yml")));
      assert.ok(!r.plan.some((p) => p.path.startsWith("src/")));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("filters by component group", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const r = await addComponent(repo, {
        starter: "discord-bot",
        component: "security",
        fetchOptions: { fetchImpl: fakeFetch(tarball) },
      });
      assert.deepEqual(
        r.plan.map((p) => p.path).sort(),
        [...COMPONENT_GROUPS.security].sort(),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("marks files the starter doesn't have as absent-in-starter", async () => {
    const repo = makeRepo();
    try {
      const partial = { ...STARTER_FILES };
      delete partial[".github/workflows/maintenance.yml"];
      const tarball = await packStarter(partial);
      const r = await addComponent(repo, {
        starter: "discord-bot",
        component: "maintenance",
        fetchOptions: { fetchImpl: fakeFetch(tarball) },
      });
      const byPath = Object.fromEntries(r.plan.map((p) => [p.path, p.action]));
      assert.equal(byPath[".github/workflows/maintenance.yml"], "absent-in-starter");
      assert.equal(byPath[".github/workflows/stale.yml"], "create");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("addComponent — apply", () => {
  it("writes planned files on dry_run=false, then re-runs as identical", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const opts = { starter: "discord-bot", fetchOptions: { fetchImpl: fakeFetch(tarball) } };
      const applied = await addComponent(repo, { ...opts, dryRun: false });
      assert.equal(applied.written.length, Object.values(COMPONENT_GROUPS).flat().length);
      assert.equal(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf-8"), "name: CI\n");

      git(repo, ["add", "."]);
      git(repo, ["commit", "-qm", "lift"]);
      const again = await addComponent(repo, { ...opts });
      for (const entry of again.plan) assert.equal(entry.action, "identical");
      assert.match(formatAddComponentReport(again), /nothing to do/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("skips differing files without force, overwrites with force", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const opts = { starter: "discord-bot", component: "ci" as const, fetchOptions: { fetchImpl: fakeFetch(tarball) } };
      mkdirSync(join(repo, ".github/workflows"), { recursive: true });
      writeFileSync(join(repo, ".github/workflows/ci.yml"), "name: MINE\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-qm", "own ci"]);

      const skipped = await addComponent(repo, { ...opts, dryRun: false });
      assert.equal(skipped.plan[0].action, "skip-exists");
      assert.equal(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf-8"), "name: MINE\n");

      const forced = await addComponent(repo, { ...opts, dryRun: false, force: true });
      assert.equal(forced.plan[0].action, "overwrite");
      assert.equal(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf-8"), "name: CI\n");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses to apply onto a dirty tree without force, but dry-runs fine", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const opts = { starter: "discord-bot", fetchOptions: { fetchImpl: fakeFetch(tarball) } };
      writeFileSync(join(repo, "uncommitted.txt"), "wip\n");
      await assert.rejects(
        () => addComponent(repo, { ...opts, dryRun: false }),
        /dirty/,
      );
      const dry = await addComponent(repo, { ...opts });
      assert.equal(dry.dryRun, true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("warns (but proceeds) when the target is not a git repo", async () => {
    const repo = makeRepo({ gitInit: false });
    try {
      const tarball = await packStarter(STARTER_FILES);
      const r = await addComponent(repo, {
        starter: "discord-bot",
        component: "ci",
        dryRun: false,
        fetchOptions: { fetchImpl: fakeFetch(tarball) },
      });
      assert.ok(r.warnings.some((w) => /not a git repo/.test(w)));
      assert.equal(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf-8"), "name: CI\n");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("addComponent — starter resolution", () => {
  it("auto-detects the starter from repo signals when omitted", async () => {
    const repo = makeRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const r = await addComponent(repo, { fetchOptions: { fetchImpl: fakeFetch(tarball) } });
      assert.equal(r.starter, "discord-bot");
      assert.equal(r.starterSource, "detected");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects an unknown starter id with the known list", async () => {
    const repo = makeRepo();
    try {
      await assert.rejects(
        () => addComponent(repo, { starter: "nope" }),
        /unknown starter 'nope'.*discord-bot/s,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects an unknown component group", async () => {
    const repo = makeRepo();
    try {
      await assert.rejects(
        () => addComponent(repo, { component: "everything" as never }),
        /unknown component/,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("addComponent — cold-start rescue of a vibe-coded export", () => {
  /** A Vite + React SPA, the shape a Lovable/v0/Bolt export actually has. */
  function makeViteRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "ac-vite-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "my-app", version: "0.0.0", private: true,
        scripts: { dev: "vite", build: "vite build" },
        dependencies: { react: "^18", "react-dom": "^18" },
        devDependencies: { vite: "^5" },
      }),
    );
    git(dir, ["init", "-q"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "init"]);
    return dir;
  }

  it("detects a low-confidence deploy starter and WARNS instead of throwing", async () => {
    const repo = makeViteRepo();
    try {
      const tarball = await packStarter(STARTER_FILES);
      const r = await addComponent(repo, { fetchOptions: { fetchImpl: fakeFetch(tarball) } });
      assert.equal(r.starter, "cloudflare-pages");
      assert.equal(r.starterSource, "detected");
      assert.equal(r.dryRun, true);
      // The warning is a product surface: it names the guess, the confidence,
      // the reason, and how to override.
      const warning = r.warnings.find((w) => /cloudflare-pages/.test(w));
      assert.ok(warning, "expected a low-confidence detection warning");
      assert.match(warning!, /low confidence/);
      assert.match(warning!, /front-end web app/);
      assert.match(warning!, /--starter/);
      const text = formatAddComponentReport(r);
      assert.match(text, /mode: DRY-RUN/);
      assert.match(text, /review the plan above, then apply with: create-starter add-component \[path\] --apply/);
      assert.match(text, /warning: detected 'cloudflare-pages'/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("hard-fails with a GUIDED fork when nothing matches (not a raw id dump)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ac-empty-"));
    writeFileSync(join(repo, "README.md"), "# just docs\n");
    try {
      await assert.rejects(
        () => addComponent(repo),
        (err: Error) => {
          assert.match(err.message, /cloudflare-pages/);
          assert.match(err.message, /docker-deploy/);
          assert.match(err.message, /npm-package/);
          assert.match(err.message, /web app|static site/);
          return true;
        },
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
