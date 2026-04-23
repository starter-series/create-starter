import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { create as createTar } from "tar";
import { scaffold } from "../src/scaffold.ts";
import type { Template } from "../src/templates.ts";

/**
 * Build a fake starter directory tree inside `root`. GitHub-archive tarballs
 * wrap everything under a top-level "<repo>-<ref>/" directory, which our
 * extractor strips via `strip: 1`. We replicate that wrapper here.
 */
function buildFakeStarter(root: string, wrapperDir: string, files: Record<string, string>): void {
  const wrapperPath = join(root, wrapperDir);
  mkdirSync(wrapperPath, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = join(wrapperPath, relPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  }
}

async function packToBuffer(root: string, wrapperDir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = createTar({ cwd: root, gzip: true, portable: true }, [wrapperDir]);
  await pipeline(
    stream as unknown as NodeJS.ReadableStream,
    async function* (source: AsyncIterable<Buffer | string>) {
      for await (const chunk of source) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
    },
  );
  return Buffer.concat(chunks);
}

function fakeFetch(tarball: Buffer): typeof fetch {
  return (async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(tarball);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-length": String(tarball.byteLength) },
    });
  }) as unknown as typeof fetch;
}

function fakeFetchFailing(): typeof fetch {
  return (async () => {
    throw new Error("simulated network failure");
  }) as unknown as typeof fetch;
}

function fakeFetchCorruptTarball(): typeof fetch {
  return (async () => {
    const payload = Buffer.from("not-a-real-tarball-just-garbage-bytes");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-length": String(payload.byteLength) },
    });
  }) as unknown as typeof fetch;
}

interface IntegrationEnv {
  workspace: string;
  packageRoot: string;
  cleanup: () => void;
}

function setupEnv(): IntegrationEnv {
  const workspace = mkdtempSync(join(tmpdir(), "create-starter-int-"));
  const packageRoot = mkdtempSync(join(tmpdir(), "create-starter-pkg-"));
  return {
    workspace,
    packageRoot,
    cleanup: () => {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(packageRoot, { recursive: true, force: true });
    },
  };
}

describe("scaffold end-to-end", () => {
  let env: IntegrationEnv;
  beforeEach(() => {
    env = setupEnv();
  });
  afterEach(() => {
    env.cleanup();
  });

  it("downloads, extracts, and customizes a template", async () => {
    const template: Template = {
      id: "test-js",
      name: "Test JS Template",
      description: "test",
      repo: "starter-series/test-js-starter",
      stack: ["javascript"],
      category: "package",
      defaults: { name: "my-template", description: "A test starter" },
      postSteps: ["npm install"],
    };

    buildFakeStarter(env.packageRoot, "test-js-starter-main", {
      "package.json": JSON.stringify(
        { name: "my-template", description: "A test starter", version: "0.0.0" },
        null,
        2,
      ),
      "README.md": "# my-template\n\nA test starter.\n",
      "src/index.js": 'console.log("my-template");\n',
      "LICENSE": "MIT License\n",
    });
    const tarball = await packToBuffer(env.packageRoot, "test-js-starter-main");

    const result = await scaffold({
      template,
      projectName: "my-real-app",
      description: "My real app",
      cwd: env.workspace,
      initGit: false,
      fetchOptions: { fetchImpl: fakeFetch(tarball) },
    });

    assert.equal(result.path, join(env.workspace, "my-real-app"));
    assert.ok(result.filesExtracted >= 4, `expected >=4 extracted, got ${result.filesExtracted}`);
    assert.ok(result.filesReplaced >= 2, `expected >=2 replaced, got ${result.filesReplaced}`);
    assert.equal(result.gitInitialized, false);

    // Verify the atomic rename produced the expected final tree
    const entries = readdirSync(result.path).sort();
    assert.ok(entries.includes("package.json"));
    assert.ok(entries.includes("README.md"));
    assert.ok(entries.includes("src"));
    assert.ok(entries.includes("LICENSE"));

    // Placeholder substitution
    const pkg = JSON.parse(readFileSync(join(result.path, "package.json"), "utf-8"));
    assert.equal(pkg.name, "my-real-app");
    assert.equal(pkg.description, "My real app");

    const readme = readFileSync(join(result.path, "README.md"), "utf-8");
    assert.ok(readme.includes("# my-real-app"), `README should reference new name: ${readme}`);
    assert.ok(readme.includes("My real app"), `README should reference new description: ${readme}`);

    const src = readFileSync(join(result.path, "src/index.js"), "utf-8");
    assert.ok(src.includes("my-real-app"));

    // No stray incomplete tmp dir in the parent
    const stray = readdirSync(env.workspace).filter((n) =>
      n.startsWith(`.${basename(result.path)}-incomplete-`),
    );
    assert.deepEqual(stray, [], `expected no leftover tmp dir, found: ${stray.join(", ")}`);
  });

  it("also renames the python package dir and pyproject entries", async () => {
    const template: Template = {
      id: "test-py",
      name: "Test PY Template",
      description: "test",
      repo: "starter-series/test-py-starter",
      stack: ["python"],
      category: "mcp",
      defaults: { name: "my-py-pkg", description: "A test py pkg" },
      postSteps: ["pip install -e ."],
    };

    buildFakeStarter(env.packageRoot, "test-py-starter-main", {
      "pyproject.toml": [
        "[project]",
        'name = "my-py-pkg"',
        'description = "A test py pkg"',
        "",
        "[tool.hatch.build.targets.wheel]",
        'packages = ["src/my_py_pkg"]',
        "",
      ].join("\n"),
      "src/my_py_pkg/__init__.py": '"""my-py-pkg"""\n',
      "README.md": "# my-py-pkg\n",
    });
    const tarball = await packToBuffer(env.packageRoot, "test-py-starter-main");

    const result = await scaffold({
      template,
      projectName: "user-project",
      cwd: env.workspace,
      initGit: false,
      fetchOptions: { fetchImpl: fakeFetch(tarball) },
    });

    const pyproject = readFileSync(join(result.path, "pyproject.toml"), "utf-8");
    assert.ok(pyproject.includes('name = "user-project"'));
    assert.ok(pyproject.includes('packages = ["src/user_project"]'));
    assert.ok(!pyproject.includes("my_py_pkg"));
    assert.ok(!pyproject.includes("my-py-pkg"));

    // Python dir renamed
    const srcEntries = readdirSync(join(result.path, "src"));
    assert.deepEqual(srcEntries, ["user_project"]);
  });

  it("cleans up the tmp dir when the download fails", async () => {
    const template: Template = {
      id: "test-fail",
      name: "Test Fail",
      description: "test",
      repo: "starter-series/test-fail-starter",
      stack: ["javascript"],
      category: "package",
      defaults: { name: "my-template", description: "A test starter" },
      postSteps: [],
    };

    await assert.rejects(
      scaffold({
        template,
        projectName: "doomed-project",
        cwd: env.workspace,
        initGit: false,
        fetchOptions: { fetchImpl: fakeFetchFailing(), maxRetries: 1 },
      }),
    );

    const leftovers = readdirSync(env.workspace);
    assert.deepEqual(leftovers, [], `expected empty workspace, got: ${leftovers.join(", ")}`);
  });

  it("cleans up when tar extraction fails on a corrupt archive", async () => {
    const template: Template = {
      id: "test-corrupt",
      name: "Test Corrupt",
      description: "test",
      repo: "starter-series/test-corrupt",
      stack: ["javascript"],
      category: "package",
      defaults: { name: "my-template", description: "A test starter" },
      postSteps: [],
    };

    await assert.rejects(
      scaffold({
        template,
        projectName: "corrupt-project",
        cwd: env.workspace,
        initGit: false,
        fetchOptions: { fetchImpl: fakeFetchCorruptTarball(), maxRetries: 1 },
      }),
    );

    const leftovers = readdirSync(env.workspace);
    assert.deepEqual(leftovers, [], `expected empty workspace after corrupt tar, got: ${leftovers.join(", ")}`);
  });

  it("refuses to scaffold into a non-empty existing directory", async () => {
    const template: Template = {
      id: "test-nonempty",
      name: "Test",
      description: "test",
      repo: "starter-series/test-nonempty",
      stack: ["javascript"],
      category: "package",
      defaults: { name: "my-template", description: "A test starter" },
      postSteps: [],
    };

    const preExistingDir = join(env.workspace, "my-existing");
    mkdirSync(preExistingDir, { recursive: true });
    writeFileSync(join(preExistingDir, "already-here.txt"), "existing content");

    const tarball = Buffer.from("unused");
    await assert.rejects(
      scaffold({
        template,
        projectName: "my-existing",
        cwd: env.workspace,
        initGit: false,
        fetchOptions: { fetchImpl: fakeFetch(tarball) },
      }),
      /already exists and is not empty/,
    );

    // Pre-existing content must be untouched
    const existing = readFileSync(join(preExistingDir, "already-here.txt"), "utf-8");
    assert.equal(existing, "existing content");
  });
});
