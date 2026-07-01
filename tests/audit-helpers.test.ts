import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSemver, semverCompare } from "../src/audit-helpers.ts";

// These tests pin SemVer 2.0 precedence behavior. They FAIL if semverCompare
// regresses to the old "split on [.\-+] and length-compare" implementation,
// which ranked a prerelease ABOVE its own release and let build metadata change
// ordering.
describe("semverCompare — SemVer 2.0 precedence", () => {
  const eq = (a: string, b: string) =>
    assert.equal(semverCompare(a, b), 0, `${a} should equal ${b}`);
  const gt = (a: string, b: string) => {
    assert.equal(semverCompare(a, b), 1, `${a} should be > ${b}`);
    assert.equal(semverCompare(b, a), -1, `${b} should be < ${a} (antisymmetry)`);
  };

  it("ranks a release ABOVE its own prerelease (§11.3): 1.0.0 > 1.0.0-rc.3", () => {
    // This is the core CRITICAL regression: the old code returned -1 here
    // (prerelease ranked higher) because `1.0.0-rc.3` split into a longer array.
    gt("1.0.0", "1.0.0-rc.3");
    gt("1.0.0", "1.0.0-rc.1");
    gt("2.5.0", "2.5.0-alpha");
  });

  it("ignores build metadata entirely (§10): 1.0.0+build == 1.0.0", () => {
    eq("1.0.0+build.5", "1.0.0");
    eq("1.0.0+a", "1.0.0+b");
    eq("1.0.0-rc.1+exp.sha.5114f85", "1.0.0-rc.1");
    eq("1.2.3+20260604", "1.2.3+anything");
  });

  it("treats numeric prerelease identifiers as LOWER than alphanumeric (§11.4.3)", () => {
    // numeric < alpha: 1.0.0-1 < 1.0.0-alpha
    gt("1.0.0-alpha", "1.0.0-1");
    gt("1.0.0-1.beta", "1.0.0-1.1"); // at field 2, beta(alpha) > 1(numeric)
  });

  it("compares numeric prerelease fields numerically, not lexically", () => {
    // The classic trap: "11" < "2" lexically but 11 > 2 numerically.
    gt("1.0.0-beta.11", "1.0.0-beta.2");
    gt("1.0.0-alpha.10", "1.0.0-alpha.9");
  });

  it("a larger set of prerelease fields outranks a prefix (§11.4.4)", () => {
    gt("1.0.0-alpha.1", "1.0.0-alpha");
    gt("1.0.0-alpha.beta.1", "1.0.0-alpha.beta");
  });

  it("matches the canonical §11 example ordering chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      assert.equal(
        semverCompare(chain[i], chain[i + 1]),
        -1,
        `${chain[i]} should be < ${chain[i + 1]}`,
      );
    }
  });

  it("compares core major.minor.patch numerically", () => {
    gt("2.0.0", "1.9.9");
    gt("1.10.0", "1.9.0");
    gt("1.0.10", "1.0.9");
    eq("1.2.3", "1.2.3");
  });

  it("tolerates a leading v on either side", () => {
    eq("v1.2.3", "1.2.3");
    eq("v1.2.3", "v1.2.3");
    gt("v2.0.0", "v1.0.0");
  });
});

describe("extractSemver — trailing version from prefixed/monorepo tags", () => {
  it("extracts a bare semver", () => {
    assert.equal(extractSemver("1.2.3"), "1.2.3");
    assert.equal(extractSemver("v1.2.3"), "1.2.3");
  });

  it("extracts from a scoped monorepo tag (@scope/x@1.2.3)", () => {
    assert.equal(extractSemver("@scope/pkg@1.2.3"), "1.2.3");
    assert.equal(extractSemver("starter-series@0.4.0"), "0.4.0");
  });

  it("extracts from a name-prefixed tag (pkg-name-v1.2.3, release-1.2.3)", () => {
    assert.equal(extractSemver("release-1.2.3"), "1.2.3");
    assert.equal(extractSemver("my-pkg-v2.0.1"), "2.0.1");
  });

  it("preserves prerelease and drops build metadata position correctly", () => {
    assert.equal(extractSemver("v1.2.3-rc.1"), "1.2.3-rc.1");
    assert.equal(extractSemver("pkg@1.2.3-beta.2"), "1.2.3-beta.2");
  });

  it("returns null when there is no extractable semver core", () => {
    assert.equal(extractSemver("latest"), null);
    assert.equal(extractSemver("stable"), null);
    assert.equal(extractSemver(""), null);
  });
});
