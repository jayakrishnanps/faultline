import type { PresentationPath, ReportPresentation } from "../../types/report-presentation.ts";

/** Count distinct paths across graph sides, giving changed/nearer evidence precedence. */
export function summarizePresentation(report: Pick<ReportPresentation, "nodes" | "tests">) {
  const distances = new Map<string, number>();
  for (const node of report.nodes) {
    if (node.distance === null) continue;
    const distance = node.isChanged ? 0 : node.distance;
    distances.set(node.path, Math.min(distances.get(node.path) ?? Infinity, distance));
  }
  const values = [...distances.values()];
  return {
    changed: values.filter((distance) => distance === 0).length,
    direct: values.filter((distance) => distance === 1).length,
    indirect: values.filter((distance) => distance > 1).length,
    tests: new Set(report.tests.map((test) => test.testPath)).size,
  };
}

/** A stable featured path, never a claim of a user selection or highest risk. */
export function featuredEvidence(paths: readonly PresentationPath[]): PresentationPath | null {
  return [...paths].sort((a, b) => b.paths.length - a.paths.length
    || compare(`${a.graphSide}:${a.paths.join("\0")}`, `${b.graphSide}:${b.paths.join("\0")}`))[0] ?? null;
}

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

export function graphSideLabel(side: ReportPresentation["graphSide"]): string {
  return side === "head" ? "Head" : "Base";
}
