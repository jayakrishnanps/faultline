import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { matchesGlob } from "node:path";
import { test } from "vitest";
import ts from "typescript";
import { ESLint } from "eslint";
import { compareFixtureSnapshots, fixtureContentSha, loadDemoManifest, loadDemoStore } from "../../fixtures/demo-store/loader.ts";
import { demoManifestSchema, revisionIdSchema } from "../../fixtures/demo-store/manifest-schema.ts";
import { repositorySourceInputSchema } from "../../types/domain/source.ts";
import { traceDependents } from "../../lib/analyzer/traversal.ts";
import { auditDemoStoreSources } from "../helpers/demo-store-source-audit.ts";
import vitestConfig from "../../vitest.config.ts";

test("fixture inventory is purposeful, inert and reproducible", async () => {
  const baseline = await loadDemoStore();
  assert.equal(baseline.head.files.length, 54);
  assert.equal(baseline.manifest.files.filter((file) => file.role === "route").length, 7);
  assert.equal(baseline.manifest.files.filter((file) => file.role === "test").length, 10);
  assert.ok(baseline.head.files.some((file) => file.language === "javascript"));
  assert.deepEqual(await loadDemoStore(), baseline);
  assert.deepEqual(baseline.changes, []);
  for (const file of baseline.head.files) assert.equal(file.contentSha, fixtureContentSha(file.sourceText));
  const stored = await readdir(new URL("../../fixtures/demo-store/sources/", import.meta.url), { recursive: true, withFileTypes: true });
  assert.equal(stored.filter((file) => file.isFile()).length, 57);
  assert.ok(stored.filter((file) => file.isFile()).every((file) => file.name.endsWith(".fixture")));
});

test("manifest rejects escaped paths, duplicated scenarios and unknown evidence", async () => {
  const manifest = await loadDemoManifest();
  assert.equal(demoManifestSchema.safeParse({ ...manifest, files: [{ ...manifest.files[0], path: "../escape.ts" }, ...manifest.files.slice(1)] }).success, false);
  assert.equal(demoManifestSchema.safeParse({ ...manifest, scenarios: [manifest.scenarios[0], manifest.scenarios[0], manifest.scenarios[0]] }).success, false);
  assert.equal(demoManifestSchema.safeParse({ ...manifest, expectedPaths: [{ revision: "baseline", graphSide: "head", paths: ["missing.ts", "also-missing.ts"] }] }).success, false);
  await assert.rejects(loadDemoStore("not-a-scenario"));
});

test("every scenario satisfies domain contracts and the authored full PR diff", async () => {
  const identities = new Set<string>();
  for (const revision of revisionIdSchema.options) {
    const fixture = await loadDemoStore(revision);
    assert.equal(repositorySourceInputSchema.safeParse(fixture.head).success, true);
    identities.add(fixture.head.commitSha);
    assert.deepEqual(compareFixtureSnapshots(fixture.baseline, fixture.head), fixture.changes);
    if (revision !== "baseline") assert.equal(fixture.changes.length, 1);
  }
  assert.equal(identities.size, 4);
});

test("authored expected paths exist in source imports; diagnostics stay explicit", async () => {
  for (const revision of revisionIdSchema.options) {
    const fixture = await loadDemoStore(revision);
    const audit = auditDemoStoreSources(fixture.head);
    assert.deepEqual(audit.parseFailures, [fixture.manifest.features.malformed]);
    assert.deepEqual(audit.missingImports, [fixture.manifest.features.missingImport]);
    for (const expectation of fixture.manifest.expectedPaths.filter((path) => path.revision === revision)) {
      assert.equal(expectation.graphSide, "head");
      for (let index = 1; index < expectation.paths.length; index++) {
        assert.ok(audit.relationships.some((edge) => edge.importer === expectation.paths[index] && edge.dependency === expectation.paths[index - 1]),
          `Missing reverse dependency hop in ${revision}: ${expectation.paths[index - 1]} -> ${expectation.paths[index]}`);
      }
      const reach = traceDependents(audit.graph, [expectation.paths[0]!], 12);
      assert.ok(reach.nodes.some((node) => node.file === expectation.paths.at(-1)));
    }
    const cycle = fixture.manifest.features.cycle;
    for (let index = 1; index < cycle.length; index++) assert.ok(audit.relationships.some((edge) => edge.importer === cycle[index - 1] && edge.dependency === cycle[index]));
    assert.ok(!audit.relationships.some((edge) => edge.importer === fixture.manifest.features.isolated || edge.dependency === fixture.manifest.features.isolated));
    assert.ok(audit.relationships.some((edge) => edge.isTypeOnly && edge.sourceLine > 0));
    for (const edgeType of ["re_export", "dynamic_import", "require"]) assert.ok(audit.relationships.some((edge) => edge.edgeType === edgeType));
  }
});

test("follow-up restores auth and reduces actual full-PR dependency reach", async () => {
  const broad = await loadDemoStore("shared-authentication");
  const followUp = await loadDemoStore("localized-follow-up");
  const localized = await loadDemoStore("localized");
  const authPath = "src/auth/token.ts";
  assert.equal(followUp.manifest.scenarios.find((scenario) => scenario.id === "localized-follow-up")?.previousScenario, "shared-authentication");
  assert.equal(followUp.baseline.commitSha, broad.baseline.commitSha);
  assert.equal(followUp.head.files.find((file) => file.path === authPath)?.sourceText, followUp.baseline.files.find((file) => file.path === authPath)?.sourceText);
  assert.notEqual(broad.head.files.find((file) => file.path === authPath)?.sourceText, broad.baseline.files.find((file) => file.path === authPath)?.sourceText);
  assert.deepEqual(followUp.changes.map((change) => change.path), ["src/billing/format-label.ts"]);
  const lastCommitChanges = compareFixtureSnapshots(broad.head, followUp.head);
  assert.deepEqual(lastCommitChanges.map((change) => change.path), [authPath, "src/billing/format-label.ts"]);
  const reach = (fixture: typeof broad, changes = fixture.changes) => traceDependents(auditDemoStoreSources(fixture.head).graph, changes.map((change) => change.path), 12);
  const broadReach = reach(broad);
  const followUpReach = reach(followUp);
  const localizedReach = reach(localized);
  assert.ok(broadReach.nodes.length > followUpReach.nodes.length);
  assert.ok(broadReach.nodes.length > localizedReach.nodes.length);
  assert.ok(reach(followUp, lastCommitChanges).nodes.length > followUpReach.nodes.length, "Using only the latest commit diff would incorrectly keep auth as a changed root");
  assert.ok(!followUpReach.nodes.some((node) => node.file === "app/dashboard/page.tsx"));
  assert.ok(followUpReach.nodes.some((node) => node.file === "app/billing/page.tsx"));
  assert.ok([broadReach, followUpReach, localizedReach].every((report) => !report.truncated));
});

test("source-under-analysis stays outside normal TypeScript, ESLint and test discovery", async () => {
  const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  assert.equal(configFile.error, undefined);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
  assert.ok(config.fileNames.every((path) => !path.replaceAll("\\", "/").includes("fixtures/demo-store/sources/")));
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored("fixtures/demo-store/sources/baseline/src/diagnostics/malformed.ts.fixture"), true);
  // The directory exclusion also protects a future accidental .ts extension.
  assert.equal(await eslint.isPathIgnored("fixtures/demo-store/sources/baseline/src/diagnostics/malformed.ts"), true);
  const manifest: unknown = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null && "scripts" in manifest);
  const scripts = manifest.scripts;
  assert.ok(typeof scripts === "object" && scripts !== null && "test:unit" in scripts && "test:database" in scripts);
  assert.equal(scripts["test:unit"], "vitest run");
  assert.equal(scripts["test:database"], "node --test tests/database/*.test.ts");
  const include = vitestConfig.test?.include ?? [];
  const discovers = (path: string) => include.some((pattern) => matchesGlob(path, pattern));
  assert.equal(vitestConfig.test?.environment, "node");
  assert.equal(discovers("tests/unit/analyzer/imports.test.ts"), true);
  assert.equal(discovers("tests/unit/components/report.test.tsx"), true);
  for (const path of [
    "fixtures/demo-store/sources/baseline/tests/auth-token.test.ts.fixture",
    "fixtures/demo-store/sources/baseline/tests/auth-token.test.ts",
    "fixtures/demo-store/example.test.tsx",
    "tests/database/schema.test.ts",
    "tests/e2e/report.test.ts",
  ]) assert.equal(discovers(path), false, `Unexpected unit test discovery: ${path}`);
});
