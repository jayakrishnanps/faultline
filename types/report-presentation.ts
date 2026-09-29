import type { GraphSide } from "./domain/primitives.ts";
import type { EvidencePath, ImpactedNode, ReportGraphEdge, TestAssociation } from "./domain/report.ts";
import type { DependencyEdge } from "./graph.ts";

/** Interface projection, not a database row or a claim that an analysis completed. */
export type PresentationNode = Pick<ImpactedNode, "path" | "graphSide" | "isChanged"> & {
  readonly distance: number | null;
};
export type PresentationPath = Pick<EvidencePath, "graphSide" | "paths" | "pathType">;
export type PresentationEdge = Pick<ReportGraphEdge, "graphSide" | "displayedImpact"> & {
  readonly storedImport: DependencyEdge;
};
export type PresentationTest = Pick<TestAssociation, "graphSide" | "testPath" | "associationType"> & {
  readonly targetPath: string;
};

export interface ReportPresentation {
  readonly provenance: {
    readonly kind: "presentation_sample" | "analyzer_output";
    readonly label: string;
    readonly explanation: string;
  };
  readonly title: string;
  readonly repositoryLabel: string;
  readonly revisionLabel: string;
  readonly graphSide: GraphSide;
  readonly nodes: readonly PresentationNode[];
  readonly edges: readonly PresentationEdge[];
  readonly paths: readonly PresentationPath[];
  readonly tests: readonly PresentationTest[];
  readonly owners: {
    readonly state: "unavailable";
    readonly explanation: string;
  } | {
    readonly state: "available";
    readonly assignments: readonly { readonly path: string; readonly owners: readonly string[] }[];
  };
  readonly traversal: { readonly maxDepth: number; readonly truncated: boolean };
  readonly limitations: readonly string[];
}
