import assert from "node:assert/strict";
import { test } from "vitest";
import { traceDependents } from "../../lib/analyzer/traversal.ts";
import { demoChangedFiles, demoGraph } from "../../fixtures/demo-store/graph.ts";
import type { DependencyGraph } from "../../types/graph.ts";

const graph: DependencyGraph = {
  files: ["a", "b", "c", "d", "isolated"],
  edges: [
    { importer: "b", dependency: "a" },
    { importer: "c", dependency: "a" },
    { importer: "d", dependency: "c" },
    { importer: "d", dependency: "b" },
  ],
};

test("traverses importers, excludes disconnected files, and selects a deterministic shortest path", () => {
  const report = traceDependents(graph, ["a"]);
  assert.deepEqual(report.nodes, [
    { file: "a", distance: 0, path: ["a"] },
    { file: "b", distance: 1, path: ["a", "b"] },
    { file: "c", distance: 1, path: ["a", "c"] },
    { file: "d", distance: 2, path: ["a", "b", "d"] },
  ]);
  assert.equal(report.truncated, false);
  assert.deepEqual(traceDependents(graph, ["d"]).nodes, [{ file: "d", distance: 0, path: ["d"] }]);
});

test("input order does not change the report", () => {
  const reversed = { files: [...graph.files].reverse(), edges: [...graph.edges].reverse() };
  assert.deepEqual(traceDependents(reversed, ["b", "a"]), traceDependents(graph, ["a", "b"]));
});

test("multiple changed files retain zero distance and the nearest root wins", () => {
  assert.deepEqual(traceDependents(graph, ["a", "c", "c"]).nodes, [
    { file: "a", distance: 0, path: ["a"] },
    { file: "c", distance: 0, path: ["c"] },
    { file: "b", distance: 1, path: ["a", "b"] },
    { file: "d", distance: 1, path: ["c", "d"] },
  ]);
});

test("terminates on cycles, self edges, and duplicate edges", () => {
  const cyclic: DependencyGraph = {
    files: ["a", "b"],
    edges: [
      { importer: "b", dependency: "a" },
      { importer: "b", dependency: "a" },
      { importer: "a", dependency: "b" },
      { importer: "a", dependency: "a" },
    ],
  };
  const report = traceDependents(cyclic, ["a"], 1);
  assert.equal(report.nodes.length, 2);
  assert.equal(report.truncated, false);
});

test("reports depth truncation, including a zero-depth request", () => {
  const report = traceDependents(graph, ["a"], 1);
  assert.deepEqual(report.nodes.map((node) => node.file), ["a", "b", "c"]);
  assert.equal(report.truncated, true);
  assert.equal(traceDependents(graph, ["a"], 0).truncated, true);
  assert.equal(traceDependents(graph, ["d"], 0).truncated, false);
  assert.equal(traceDependents(graph, ["a", "d"], 1).truncated, false);
});

test("reports unknown changes instead of inventing graph nodes", () => {
  const report = traceDependents(graph, ["deleted.ts", "deleted.ts"]);
  assert.deepEqual(report.unknownChangedFiles, ["deleted.ts"]);
  assert.deepEqual(report.nodes, []);
  assert.equal(report.truncated, false);
});

test("empty graphs and empty change sets produce empty reports", () => {
  assert.deepEqual(traceDependents({ files: [], edges: [] }, []).nodes, []);
  assert.deepEqual(traceDependents(graph, []).nodes, []);
});

test("rejects invalid depth values and inconsistent graphs explicitly", () => {
  for (const depth of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => traceDependents(graph, ["a"], depth), RangeError);
  }
  assert.throws(() => traceDependents({ files: ["a", "a"], edges: [] }, []), /unique/);
  assert.throws(() => traceDependents({ files: [""], edges: [] }, []), /non-empty/);
  assert.throws(() => traceDependents({ files: ["a"], edges: [{ importer: "b", dependency: "a" }] }, []), /unknown file/);
  assert.throws(() => traceDependents({ files: ["a"], edges: [{ importer: "a", dependency: "b" }] }, []), /unknown file/);
});

test("sample report reaches billing through the session and billing client", () => {
  const report = traceDependents(demoGraph, demoChangedFiles);
  assert.equal(report.nodes.length, 6);
  assert.deepEqual(report.nodes.find((node) => node.file === "app/api/billing/route.ts")?.path, [
    "src/auth/token.ts", "src/auth/session.ts", "src/billing/client.ts", "app/api/billing/route.ts",
  ]);
  assert.equal(report.nodes.some((node) => node.file === "src/catalog/products.ts"), false);
});

test("does not mutate the supplied graph or changed files", () => {
  const frozenGraph = Object.freeze({
    files: Object.freeze([...graph.files]),
    edges: Object.freeze(graph.edges.map((edge) => Object.freeze({ ...edge }))),
  });
  assert.doesNotThrow(() => traceDependents(frozenGraph, Object.freeze(["a"])));
});
