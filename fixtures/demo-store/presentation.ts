import { traceDependents } from "../../lib/analyzer/traversal.ts";
import type { ReportPresentation } from "../../types/report-presentation.ts";
import { demoChangedFiles, demoGraph } from "./graph.ts";

/** The only sample-data adapter used by the interface. Called on the server. */
export function createDemoPresentation(): ReportPresentation {
  const reach = traceDependents(demoGraph, demoChangedFiles);
  const reached = new Map(reach.nodes.map((node) => [node.file, node]));
  return {
    provenance: {
      kind: "presentation_sample",
      label: "Local demonstration · hand-authored sample",
      explanation: "This is an illustrative PR report, not a GitHub pull request. Its seven-file graph is hand-authored; only reach and paths are computed locally. No source analysis or GitHub operation has run.",
    },
    title: "Refresh authentication tokens",
    repositoryLabel: "demo-store · local sample",
    revisionLabel: "presentation-v1 · illustrative revision, not a Git commit",
    graphSide: "head",
    nodes: demoGraph.files.map((path) => ({
      path, graphSide: "head", isChanged: reached.get(path)?.distance === 0,
      distance: reached.get(path)?.distance ?? null,
    })),
    edges: demoGraph.edges.map((edge) => ({
      graphSide: "head", storedImport: edge,
      displayedImpact: { from: edge.dependency, to: edge.importer },
    })),
    paths: reach.nodes.map((node) => ({ graphSide: "head", paths: [...node.path], pathType: "shortest" })),
    tests: reach.nodes.filter((node) => node.file === "tests/session.test.ts").map((node) => ({
      graphSide: "head", testPath: node.file, targetPath: node.path[0]!, associationType: "dependency_path",
    })),
    owners: { state: "unavailable", explanation: "Owner resolution is not implemented. CODEOWNERS has not been read, and no people or teams have been assigned." },
    traversal: { maxDepth: reach.maxDepth, truncated: reach.truncated },
    limitations: [
      "This small presentation sample is separate from the 54-file demo-store source collection.",
      "Source parsing, impact scoring and base-to-head comparison are not represented here.",
      "Dependency reach does not prove a behavioral change, a failure or test coverage.",
    ],
  };
}
