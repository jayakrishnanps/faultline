import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoPresentation } from "../../fixtures/demo-store/presentation.ts";
import { featuredEvidence, summarizePresentation } from "../../lib/data/report-presentation.ts";
import type { PresentationPath } from "../../types/report-presentation.ts";

test("presentation sample derives its counts and evidence from the existing hand-authored graph", () => {
  const report = createDemoPresentation();
  assert.equal(report.provenance.kind, "presentation_sample");
  assert.equal(report.nodes.length, 7);
  assert.deepEqual(summarizePresentation(report), { changed: 1, direct: 1, indirect: 4, tests: 1 });
  assert.equal(report.owners.state, "unavailable");
  assert.ok(report.nodes.some((node) => node.path === "src/catalog/products.ts" && node.distance === null));
  for (const edge of report.edges) {
    assert.equal(edge.displayedImpact.from, edge.storedImport.dependency);
    assert.equal(edge.displayedImpact.to, edge.storedImport.importer);
  }
  for (const path of report.paths) {
    for (let index = 1; index < path.paths.length; index++) {
      assert.ok(report.edges.some((edge) => edge.graphSide === path.graphSide
        && edge.displayedImpact.from === path.paths[index - 1] && edge.displayedImpact.to === path.paths[index]));
    }
  }
});

test("summary counts distinct paths across sides and does not count changed roots as dependents", () => {
  const sample = createDemoPresentation();
  const summary = summarizePresentation({
    nodes: [
      { path: "changed.ts", graphSide: "head", isChanged: true, distance: 0 },
      { path: "changed.ts", graphSide: "base", isChanged: false, distance: 2 },
      { path: "dependent.ts", graphSide: "head", isChanged: false, distance: 1 },
      { path: "dependent.ts", graphSide: "base", isChanged: false, distance: 3 },
      { path: "isolated.ts", graphSide: "head", isChanged: false, distance: null },
    ],
    tests: [...sample.tests, ...sample.tests],
  });
  assert.deepEqual(summary, { changed: 1, direct: 1, indirect: 0, tests: 1 });
});

test("empty supplied data has no featured path and no fabricated summary evidence", () => {
  assert.equal(featuredEvidence([]), null);
  assert.deepEqual(summarizePresentation({ nodes: [], tests: [] }), { changed: 0, direct: 0, indirect: 0, tests: 0 });
});

test("featured evidence is stable under input reordering and keeps revision paths separate", () => {
  const paths: PresentationPath[] = [
    { graphSide: "head", pathType: "shortest", paths: ["root.ts", "b.ts"] },
    { graphSide: "base", pathType: "shortest", paths: ["root.ts", "a.ts"] },
    { graphSide: "head", pathType: "shortest", paths: ["root.ts"] },
  ];
  const original = structuredClone(paths);
  assert.deepEqual(featuredEvidence(paths), paths[1]);
  assert.deepEqual(featuredEvidence([...paths].reverse()), paths[1]);
  assert.deepEqual(paths, original);
  assert.deepEqual(featuredEvidence(createDemoPresentation().paths)?.paths, [
    "src/auth/token.ts", "src/auth/session.ts", "src/billing/client.ts", "app/api/billing/route.ts",
  ]);
});
