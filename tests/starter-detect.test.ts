import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractStarterSignals } from "../src/starter-detect.ts";

/**
 * Cold-start detection fixtures: the repo shapes a vibe-coder actually arrives
 * with after exporting from Lovable / v0 / Bolt, plus the strong-signal repos.
 * Locks the behavior that `npx ... add-component` depends on — a Vite/Next/etc.
 * export must RESOLVE to a deploy starter (low confidence) instead of dead-ending.
 */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sd-fix-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}
const pkg = (o: unknown): Record<string, string> => ({ "package.json": JSON.stringify(o) });

function detect(files: Record<string, string>): { id: string | null; confidence: string; reason: string } {
  const dir = fixture(files);
  try {
    const s = extractStarterSignals(dir);
    return { id: s.id, confidence: s.confidence, reason: s.signals[s.signals.length - 1] ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("extractStarterSignals — strong (high-confidence) matches", () => {
  const high: Array<[string, Record<string, string>, string]> = [
    ["discord.js", pkg({ dependencies: { "discord.js": "^14" } }), "discord-bot"],
    ["grammy", pkg({ dependencies: { grammy: "^1" } }), "telegram-bot"],
    ["@modelcontextprotocol/sdk", pkg({ dependencies: { "@modelcontextprotocol/sdk": "^1" } }), "mcp-server"],
    ["expo", pkg({ dependencies: { expo: "^51" } }), "react-native"],
    ["electron", pkg({ devDependencies: { electron: "^31" } }), "electron-app"],
    ["MV3 manifest", { "manifest.json": JSON.stringify({ manifest_version: 3, version: "1.0" }) }, "browser-extension"],
    ["wrangler.toml", { "wrangler.toml": "name='x'\n", ...pkg({ dependencies: { react: "^18" } }) }, "cloudflare-pages"],
  ];
  for (const [label, files, expected] of high) {
    it(`${label} → ${expected} (high)`, () => {
      const d = detect(files);
      assert.equal(d.id, expected);
      assert.equal(d.confidence, "high");
    });
  }
});

describe("extractStarterSignals — vibe-coded exports resolve instead of dead-ending", () => {
  it("Vite + React SPA (v0/Bolt) → cloudflare-pages (low)", () => {
    const d = detect(pkg({ dependencies: { react: "^18" }, devDependencies: { vite: "^5" } }));
    assert.equal(d.id, "cloudflare-pages");
    assert.equal(d.confidence, "low");
    assert.match(d.reason, /front-end web app/);
  });

  it("Next.js app (Lovable/v0) → cloudflare-pages (low)", () => {
    const d = detect(pkg({ dependencies: { next: "14.2.5", react: "^18" } }));
    assert.equal(d.id, "cloudflare-pages");
    assert.equal(d.confidence, "low");
  });

  it("Vite + React + Supabase (typical Lovable) → cloudflare-pages (low)", () => {
    const d = detect(pkg({ dependencies: { react: "^18", "@supabase/supabase-js": "^2" }, devDependencies: { vite: "^5" } }));
    assert.equal(d.id, "cloudflare-pages");
    assert.equal(d.confidence, "low");
  });

  it("plain Express API → docker-deploy (low)", () => {
    const d = detect(pkg({ dependencies: { express: "^4" } }));
    assert.equal(d.id, "docker-deploy");
    assert.equal(d.confidence, "low");
    assert.match(d.reason, /node server/);
  });

  it("an explicit Dockerfile wins over the framework guess", () => {
    const d = detect({ "Dockerfile": "FROM node:22\n", ...pkg({ dependencies: { react: "^18" }, devDependencies: { vite: "^5" } }) });
    assert.equal(d.id, "docker-deploy");
    assert.equal(d.confidence, "low");
    assert.match(d.reason, /Dockerfile/);
  });
});

describe("extractStarterSignals — genuine non-matches still report none", () => {
  it("empty repo → id null, confidence none", () => {
    const d = detect({ "README.md": "# hi\n" });
    assert.equal(d.id, null);
    assert.equal(d.confidence, "none");
  });

  it("static HTML site with no package.json → id null, confidence none", () => {
    const d = detect({ "index.html": "<!doctype html>", "style.css": "body{}" });
    assert.equal(d.id, null);
    assert.equal(d.confidence, "none");
  });
});
