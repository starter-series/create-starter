import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf-8");
}

describe("GitHub Pages landing", () => {
  it("keeps the public landing page multilingual and wired to the Pages homepage", () => {
    const pkg = JSON.parse(read("package.json")) as { homepage: string };
    const html = read("docs/index.html");
    const script = read("docs/script.js");
    const styles = read("docs/styles.css");

    assert.equal(pkg.homepage, "https://starter-series.github.io/create-starter/");
    assert.match(html, /<title>create-starter<\/title>/);
    assert.match(html, /rel="canonical" href="https:\/\/starter-series\.github\.io\/create-starter\/"/);
    assert.match(html, /hreflang="en"/);
    assert.match(html, /hreflang="ko"/);
    assert.match(html, /hreflang="ja"/);
    assert.match(html, /data-lang="en"/);
    assert.match(html, /data-lang="ko"/);
    assert.match(html, /data-lang="ja"/);
    assert.match(html, /<h1>create-starter<\/h1>/);
    assert.match(styles, /\.language-switcher/);
    assert.match(styles, /@media \(max-width: 620px\)/);

    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(keys.length > 20, "landing page should have translated interface copy");
    for (const key of keys) {
      const quotedKey = JSON.stringify(key);
      const occurrences = script.split(quotedKey).length - 1;
      assert.equal(occurrences, 3, `${key} should be translated in en, ko, and ja`);
    }
  });
});
