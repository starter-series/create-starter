import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSecurityWorkflows } from "../src/security-workflows.ts";
const local = [{ file: "ci.yml", content: "jobs:\n  checks:\n    uses: starter-series/.github/.github/workflows/node.yml@main\n    with:\n      runtime: node\n" }];
test("follows fleet workflows, composite actions and invoked scripts with input branches", async () => {
  const files: Record<string,string> = {
    ".github/workflows/node.yml": "jobs:\n  node:\n    if: inputs.runtime == 'node'\n    uses: ./.github/workflows/security.yml\n  python:\n    if: inputs.runtime == 'python'\n    steps:\n    - run: pip-audit .\n",
    ".github/workflows/security.yml": "jobs:\n  audit:\n    steps:\n    - uses: starter-series/.github/.github/actions/node-security@main\n",
    ".github/actions/node-security/action.yml": 'runs:\n  using: composite\n  steps:\n  - run: node "$GITHUB_ACTION_PATH/../../../scripts/audit.cjs"\n',
    "scripts/audit.cjs": "spawnSync('npm', ['audit', '--audit-level=high']);",
  };
  const r = await expandSecurityWorkflows(local, async (path,ref) => { assert.equal(ref,"main"); assert.ok(files[path],path); return files[path]; });
  assert.deepEqual(r.unresolved, []);
  assert.ok(r.sources.some(s => s.file.includes("scripts/audit.cjs@main (sha256:") && s.content.includes("spawnSync")));
  assert.ok(!r.sources.some(s => s.content.includes("pip-audit")));
});
test("cycles terminate and repeated references are fetched once", async () => {
  let reads = 0;
  const r = await expandSecurityWorkflows([...local, {...local[0],file:"other.yml"}], async () => { reads++; return "jobs:\n  loop:\n    uses: ./.github/workflows/node.yml\n"; });
  assert.equal(reads,1); assert.deepEqual(r.unresolved,[]);
});
test("unreadable and unsupported policies remain explicitly unverified", async () => {
  const r = await expandSecurityWorkflows(local, async () => { throw new Error("HTTP 404"); });
  assert.match(r.unresolved[0],/HTTP 404/);
  const external = await expandSecurityWorkflows([{file:"ci.yml",content:"jobs:\n  ci:\n    uses: example/policy/.github/workflows/ci.yml@main\n"}], async () => { throw new Error("must not fetch unrelated owners"); });
  assert.match(external.unresolved[0],/unsupported reusable workflow/);
});
test("comments and disabled jobs do not manufacture security evidence", async () => {
  const r = await expandSecurityWorkflows([{file:"ci.yml",content:"# npm audit\njobs:\n  disabled:\n    if: false\n    steps:\n    - run: npm audit\n  active:\n    steps:\n    - run: npm ci --ignore-scripts\n    - if: false\n      run: pip-audit .\n"}]);
  assert.ok(!r.sources[0].content.includes("npm audit"));
  assert.ok(!r.sources[0].content.includes("pip-audit"));
  assert.ok(r.sources[0].content.includes("npm ci"));
});
