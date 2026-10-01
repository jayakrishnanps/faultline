import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import { discoverSources } from "../../lib/analyzer/discovery.ts";
import { analyzeSources } from "../../lib/analyzer/analyze-sources.ts";
import * as parser from "../../lib/analyzer/parser.ts";
import { analysisLimitsSchema, DEFAULT_ANALYSIS_LIMITS } from "../../types/discovery.ts";
import type { RepositoryTreeEntry, SourceAnalysisInput } from "../../types/discovery.ts";
import { loadDemoStore } from "../../fixtures/demo-store/loader.ts";
import { MAX_RELATIONSHIPS, MAX_TREE_ENTRIES } from "../../lib/analyzer/source-policy.ts";

const entry = (path: string, overrides: Partial<RepositoryTreeEntry> = {}): RepositoryTreeEntry => ({ path, kind: "file", sizeBytes: null, isBinary: false, ...overrides });
const input = (entries: RepositoryTreeEntry[], sources: SourceAnalysisInput["sources"] = []): SourceAnalysisInput => ({ tree: { entries, truncated: false }, changedPaths: [], sources });

test("SQL defaults and configurable setting bounds match the actual repository columns", async () => {
  assert.deepEqual(DEFAULT_ANALYSIS_LIMITS, { maxSourceFiles: 300, maxChangedFiles: 100, maxFileBytes: 256000, maxTotalSourceBytes: 10485760 });
  const sql = await readFile(new URL("../../Faultline-Supabase-Setup.sql", import.meta.url), "utf8");
  for (const [column, value] of [["max_source_files", 300], ["max_changed_files", 100], ["max_file_bytes", 256000], ["max_total_source_bytes", 10485760]]) {
    assert.match(sql, new RegExp(`${column} integer not null default ${value}\\b`));
  }
  for (const limits of [
    { ...DEFAULT_ANALYSIS_LIMITS, maxSourceFiles: 1001 }, { ...DEFAULT_ANALYSIS_LIMITS, maxChangedFiles: 501 },
    { ...DEFAULT_ANALYSIS_LIMITS, maxFileBytes: 1023 }, { ...DEFAULT_ANALYSIS_LIMITS, maxTotalSourceBytes: 52428801 },
  ]) assert.equal(analysisLimitsSchema.safeParse(limits).success, false);
});

test("discovery excludes dependencies, generated output, sensitive paths and irrelevant types before content access", () => {
  const excluded = ["node_modules/pkg/index.ts", "src/node_modules/pkg.ts", ".next/types/a.ts", "dist/a.js", "vendor/a.ts", "coverage/a.js", "generated/a.ts", "a.generated.ts", "a.min.js", ".env.local.ts", "credentials.ts", "secrets/key.ts", ".aws/config.ts", "private.pem.ts", "id_rsa.ts", ".pnp.cjs", "image.png", "README.md", "fixture.ts.fixture"];
  const result = analyzeSources(input([entry("src/index.ts"), ...excluded.map((path) => entry(path)), entry("linked.ts", { kind: "symlink" }), entry("package", { kind: "submodule" })], [
    { path: "src/index.ts", sourceText: "export const value = 1;" },
    ...excluded.map((path) => ({ path, get sourceText(): string { throw new Error("Excluded content must not be read"); } })),
  ]));
  assert.equal(result.status, "analyzed");
  if (result.status !== "analyzed") return;
  assert.equal(result.counts.discoveredRelevantFiles, 1);
  assert.equal(result.counts.excludedEntries, excluded.length + 2);
  assert.equal(result.counts.parsedFiles, 1);
});

test("default source and full-PR changed-file limits accept the boundary and reject the next entry", () => {
  const files = Array.from({ length: 300 }, (_, index) => entry(`src/file${index}.ts`, { sizeBytes: 0 }));
  const changedPaths = Array.from({ length: 100 }, (_, index) => `removed/file${index}.txt`);
  assert.equal(discoverSources({ ...input(files), changedPaths }).status, "ready");
  assert.deepEqual(discoverSources(input([...files, entry("extra.ts")])), { status: "limit_exceeded", limit: "maxSourceFiles", maximum: 300 });
  assert.deepEqual(discoverSources({ ...input([]), changedPaths: [...changedPaths, "extra.txt"] }), { status: "limit_exceeded", limit: "maxChangedFiles", maximum: 100 });
  assert.equal(discoverSources({ ...input([...files, entry("extra.ts")]), limits: { ...DEFAULT_ANALYSIS_LIMITS, maxSourceFiles: 301 } }).status, "ready");
});

test("metadata byte budgets reject oversized source before reading supplied text", () => {
  const source = { path: "large.ts", get sourceText(): string { throw new Error("Must reject metadata first"); } };
  const result = analyzeSources(input([entry("large.ts", { sizeBytes: 256001 })], [source]));
  assert.equal(result.status, "limit_exceeded");
  const files = Array.from({ length: 40 }, (_, index) => entry(`file${index}.ts`, { sizeBytes: 256000 }));
  files.push(entry("last.ts", { sizeBytes: 245760 }));
  assert.equal(discoverSources(input(files)).status, "ready");
  files[40] = entry("last.ts", { sizeBytes: 245761 });
  assert.deepEqual(discoverSources(input(files)), { status: "limit_exceeded", limit: "maxTotalSourceBytes", maximum: 10485760 });
});

test("UTF-8 bytes, not string length, govern exact per-file limits", () => {
  const limits = { ...DEFAULT_ANALYSIS_LIMITS, maxFileBytes: 1024 };
  const boundary = "//" + "é".repeat(511);
  assert.equal(boundary.length, 513);
  assert.equal(analyzeSources({ ...input([entry("a.ts")], [{ path: "a.ts", sourceText: boundary }]), limits }).status, "analyzed");
  const result = analyzeSources({ ...input([entry("a.ts")], [{ path: "a.ts", sourceText: boundary + "a" }]), limits });
  assert.deepEqual(result, { status: "limit_exceeded", limit: "maxFileBytes", maximum: 1024, path: "a.ts" });
});

test("validates aggregate actual bytes before any parse and accounts for known missing source", () => {
  const limits = { ...DEFAULT_ANALYSIS_LIMITS, maxTotalSourceBytes: 1024 };
  const sources = [{ path: "a.ts", sourceText: "//" + "a".repeat(510) }, { path: "b.ts", sourceText: "//" + "é".repeat(255) }];
  assert.equal(analyzeSources({ ...input([entry("a.ts"), entry("b.ts")], sources), limits }).status, "analyzed");
  const spy = vi.spyOn(parser, "parseSource");
  try {
    const tooBig = analyzeSources({ ...input([entry("a.ts"), entry("b.ts")], [sources[0]!, { ...sources[1]!, sourceText: sources[1]!.sourceText + "a" }]), limits });
    assert.deepEqual(tooBig, { status: "limit_exceeded", limit: "maxTotalSourceBytes", maximum: 1024 });
    assert.equal(spy.mock.calls.length, 0);
    const missing = analyzeSources({ ...input([entry("a.ts", { sizeBytes: 800 }), entry("b.ts")], [sources[1]!]), limits });
    assert.equal(missing.status, "limit_exceeded");
    assert.equal(spy.mock.calls.length, 0);
  } finally { spy.mockRestore(); }
});

test("rejects invalid metadata, truncated trees, duplicates and inconsistent source sizes", () => {
  assert.deepEqual(discoverSources({ ...input([]), tree: { entries: [], truncated: true } }), { status: "invalid_input", code: "truncated_tree" });
  for (const path of ["../a.ts", "C:/a.ts", "a\\b.ts"]) assert.equal(discoverSources(input([entry(path)])).status, "invalid_input");
  assert.equal(discoverSources(input([entry("a.ts"), entry("a.ts")])).status, "invalid_input");
  assert.equal(discoverSources({ ...input([]), changedPaths: ["a.ts", "a.ts"] }).status, "invalid_input");
  assert.equal(discoverSources(input([entry("a.ts", { sizeBytes: -1 })])).status, "invalid_input");
  assert.equal(discoverSources(input([entry("linked", { kind: "symlink" }), entry("linked/file.ts")])).status, "invalid_input");
  assert.deepEqual(analyzeSources(input([entry("a.ts", { sizeBytes: 1 })], [{ path: "a.ts", sourceText: "" }])), { status: "invalid_input", code: "size_mismatch", path: "a.ts" });
  assert.equal(analyzeSources(input([], [{ path: "absent.ts", sourceText: "" }])).status, "invalid_input");
  assert.equal(analyzeSources(input([entry("a.ts")], [{ path: "a.ts", sourceText: "" }, { path: "a.ts", sourceText: "" }])).status, "invalid_input");
});

test("operational bounds fail explicitly before exposing partial results", () => {
  assert.deepEqual(discoverSources(input(Array.from({ length: MAX_TREE_ENTRIES + 1 }, (_, index) => entry(`file${index}.txt`)))), {
    status: "limit_exceeded", limit: "treeEntries", maximum: MAX_TREE_ENTRIES,
  });
  const manySources = Array.from({ length: MAX_TREE_ENTRIES + 1 }, () => ({ path: "unused.ts", sourceText: "" }));
  assert.deepEqual(analyzeSources(input([], manySources)), { status: "limit_exceeded", limit: "sourceEntries", maximum: MAX_TREE_ENTRIES });
  // Isolate aggregate-budget behavior from parser cost using valid parser records.
  const parsed = parser.parseSource({ path: "a.ts", sourceText: "import 'external';" });
  assert.equal(parsed.status, "parsed");
  if (parsed.status !== "parsed") return;
  const spy = vi.spyOn(parser, "parseSource").mockReturnValue({ ...parsed, imports: Array.from({ length: 10000 }, () => parsed.imports[0]!) });
  try {
    const paths = Array.from({ length: 11 }, (_, index) => `file${index}.ts`);
    assert.deepEqual(analyzeSources(input(paths.map((path) => entry(path)), paths.map((path) => ({ path, sourceText: "" })))), {
      status: "limit_exceeded", limit: "relationships", maximum: MAX_RELATIONSHIPS,
    });
  } finally { spy.mockRestore(); }
});

test("counts disjoint file outcomes and relationship categories with explicit denominators", () => {
  const entries = ["main.ts", "ok.ts", "bad.ts", "missing.ts", "binary.ts", "nul.ts", "README.md"].map((path) => entry(path, { isBinary: path === "binary.ts" }));
  const sources = [
    { path: "main.ts", sourceText: "import './ok'; import './absent'; import 'react'; import '@/alias'; import(name); require('./legacy');" },
    { path: "ok.ts", sourceText: "export const value = 1;" }, { path: "bad.ts", sourceText: "export const value = ;" },
    { path: "nul.ts", sourceText: "\0not text" }, { path: "binary.ts", get sourceText(): string { throw new Error("Binary content must not be read"); } },
  ];
  const result = analyzeSources(input(entries, sources));
  assert.equal(result.status, "analyzed");
  if (result.status !== "analyzed") return;
  assert.deepEqual(result.counts, {
    treeEntries: 7, excludedEntries: 1, discoveredRelevantFiles: 6,
    parsedFiles: 2, failedFiles: 1, skippedFiles: 3, resolvedImports: 1,
    unresolvedLocalImports: 1, externalImports: 1, unsupportedRelationships: 3, observedRelationships: 6,
  });
  assert.deepEqual(result.skipped, [{ path: "binary.ts", reason: "binary" }, { path: "missing.ts", reason: "source_missing" }, { path: "nul.ts", reason: "binary" }]);
  assert.equal(JSON.stringify(result).includes("sourceText"), false);
  assert.deepEqual(analyzeSources(input([...entries].reverse(), [...sources].reverse())), result);
});

test("missing or failed text does not invalidate existence evidence; excluded targets do not resolve", () => {
  const result = analyzeSources(input([entry("main.ts"), entry("missing.ts"), entry("bad.ts"), entry("dist/ignored.ts")], [
    { path: "main.ts", sourceText: "import './missing'; import './bad'; import './dist/ignored';" }, { path: "bad.ts", sourceText: "const x = ;" },
  ]));
  assert.equal(result.status, "analyzed");
  if (result.status !== "analyzed") return;
  assert.equal(result.counts.resolvedImports, 2);
  assert.equal(result.counts.unresolvedLocalImports, 1);
  assert.equal(result.counts.failedFiles, 1);
  assert.equal(result.counts.skippedFiles, 1);
});

test("runs parser and resolver on the supplied demo snapshot with honest partial evidence", async () => {
  const { baseline, manifest } = await loadDemoStore();
  const result = analyzeSources(input(baseline.files.map((file) => entry(file.path, { sizeBytes: new TextEncoder().encode(file.sourceText).length })), baseline.files));
  assert.equal(result.status, "analyzed");
  if (result.status !== "analyzed") return;
  assert.equal(result.counts.discoveredRelevantFiles, 54);
  assert.equal(result.counts.parsedFiles, 53);
  assert.equal(result.counts.failedFiles, 1);
  assert.equal(result.counts.skippedFiles, 0);
  assert.ok(result.counts.resolvedImports > 0);
  assert.equal(result.counts.unresolvedLocalImports, 1);
  assert.ok(result.counts.unsupportedRelationships >= 1);
  assert.deepEqual(result.files.filter((file) => file.parse.status === "failed").map((file) => file.path), [manifest.features.malformed]);
  assert.equal(result.counts.observedRelationships, result.counts.resolvedImports + result.counts.unresolvedLocalImports + result.counts.externalImports + result.counts.unsupportedRelationships);
});
