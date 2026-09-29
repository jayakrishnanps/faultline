import { z } from "zod";
import { analysisIdSchema, analysisNodeIdSchema, analysisStatusSchema, associationTypeSchema, changeTypeSchema, countSchema, graphSideSchema, labelSchema, pathTypeSchema, percentageSchema, publishingStatusSchema, pullRequestIdSchema, repositoryIdSchema, repositoryPathSchema, shaSchema, structuralEvidenceSchema, timestampSchema } from "./primitives.ts";
import { resolvedRelationshipSchema } from "./source.ts";
import { completenessSchema, snapshotReferenceSchema } from "./snapshot.ts";

export const changedFileSchema = z.strictObject({
  path: repositoryPathSchema,
  previousPath: repositoryPathSchema.nullable(),
  changeType: changeTypeSchema,
  additions: countSchema,
  deletions: countSchema,
  isSupported: z.boolean(),
  skipReason: labelSchema.nullable(),
}).refine((file) => file.changeType !== "renamed" || file.previousPath !== null,
  { message: "Renamed files require previousPath", path: ["previousPath"] });

export const impactedNodeSchema = z.strictObject({
  id: analysisNodeIdSchema,
  graphSide: graphSideSchema,
  path: repositoryPathSchema,
  // SQL analysis_nodes.file_type is unrestricted text, unlike source_files.file_type.
  fileType: labelSchema,
  distance: z.number().int().min(0).max(100),
  isChanged: z.boolean(),
  isEntryPoint: z.boolean(),
  isTest: z.boolean(),
  isSensitive: z.boolean(),
  routePath: z.string().max(4096).nullable(),
  owners: z.array(z.string().min(1).max(200)).max(100),
  reason: labelSchema,
  evidence: structuralEvidenceSchema,
}).refine((node) => node.isChanged === (node.distance === 0),
  { message: "Changed roots have distance zero; dependents have positive distance", path: ["distance"] });

/** Never use ambiguous source/target fields for both directions. */
export const reportGraphEdgeSchema = z.strictObject({
  graphSide: graphSideSchema,
  storedImport: resolvedRelationshipSchema,
  displayedImpact: z.strictObject({ from: repositoryPathSchema, to: repositoryPathSchema }),
}).refine((edge) => edge.displayedImpact.from === edge.storedImport.dependency
  && edge.displayedImpact.to === edge.storedImport.importer,
{ message: "Displayed impact must reverse the stored import", path: ["displayedImpact"] });

export const evidencePathSchema = z.strictObject({
  targetNodeId: analysisNodeIdSchema,
  graphSide: graphSideSchema,
  pathType: pathTypeSchema,
  paths: z.array(repositoryPathSchema).min(1).max(101),
  // Evidence carries import provenance; path order follows reverse impact.
  evidence: z.array(resolvedRelationshipSchema).max(100),
}).superRefine((path, ctx) => {
  if (path.evidence.length !== path.paths.length - 1) ctx.addIssue({ code: "custom", message: "Each path hop requires import evidence", path: ["evidence"] });
  path.evidence.forEach((edge, index) => {
    if (edge.dependency !== path.paths[index] || edge.importer !== path.paths[index + 1]) ctx.addIssue({ code: "custom", message: "Evidence must follow reverse import direction", path: ["evidence", index] });
  });
});

export const testAssociationSchema = z.strictObject({
  targetNodeId: analysisNodeIdSchema,
  graphSide: graphSideSchema,
  testPath: repositoryPathSchema,
  associationType: associationTypeSchema,
  evidence: structuralEvidenceSchema,
});
export const scoreFactorSchema = z.strictObject({
  factorKey: z.string().min(1).max(200),
  label: labelSchema,
  points: percentageSchema,
  evidence: structuralEvidenceSchema,
});
export const reportCountsSchema = z.strictObject({
  changed: countSchema, direct: countSchema, indirect: countSchema,
  reachable: countSchema, entryPoints: countSchema, tests: countSchema, testGaps: countSchema,
}).refine((counts) => counts.testGaps <= counts.entryPoints,
  { message: "Test gaps cannot exceed entry points", path: ["testGaps"] });

/** Versioned interface DTO. No source text, external SDK objects or arbitrary JSON. */
export const analysisReportSchema = z.strictObject({
  contractVersion: z.literal(1),
  id: analysisIdSchema,
  repositoryId: repositoryIdSchema,
  pullRequestId: pullRequestIdSchema,
  headSha: shaSchema,
  baseSha: shaSchema,
  comparisonBaseSha: shaSchema.nullable(),
  analyzerVersion: z.string().min(1).max(200),
  configurationVersion: countSchema.min(1),
  status: analysisStatusSchema,
  publishingStatus: publishingStatusSchema,
  stage: labelSchema,
  progress: percentageSchema,
  impactScore: percentageSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  snapshots: z.strictObject({ head: snapshotReferenceSchema.nullable(), base: snapshotReferenceSchema.nullable() }),
  completeness: completenessSchema,
  counts: reportCountsSchema,
  changes: z.array(changedFileSchema).max(500),
  nodes: z.array(impactedNodeSchema).max(2000),
  edges: z.array(reportGraphEdgeSchema).max(200000),
  paths: z.array(evidencePathSchema).max(8000),
  testAssociations: z.array(testAssociationSchema).max(10000),
  scoreFactors: z.array(scoreFactorSchema).max(100),
}).superRefine((report, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const finished = report.status === "complete" || report.status === "partial";
  if (finished && (report.completedAt === null || report.impactScore === null || report.snapshots.head === null)) issue("Finished analyses require completion time, score and head snapshot", ["status"]);
  for (const side of ["head", "base"] as const) {
    const snapshot = report.snapshots[side];
    const sha = side === "head" ? report.headSha : report.comparisonBaseSha ?? report.baseSha;
    if (snapshot && (snapshot.repositoryId !== report.repositoryId || snapshot.commitSha !== sha || (finished && snapshot.status !== "ready"))) issue("Snapshot must match repository, revision and completion state", ["snapshots", side]);
  }
  const nodeKeys = new Set<string>();
  const nodesById = new Map(report.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== report.nodes.length) issue("Duplicate node IDs", ["nodes"]);
  report.nodes.forEach((node, index) => {
    const key = JSON.stringify([node.graphSide, node.path]);
    if (nodeKeys.has(key)) issue("Duplicate side/path node", ["nodes", index]);
    nodeKeys.add(key);
    if (report.snapshots[node.graphSide] === null) issue("Node has no snapshot on its graph side", ["nodes", index]);
  });
  const edgeKey = (side: string, edge: z.infer<typeof resolvedRelationshipSchema>) => JSON.stringify([side, edge.importer, edge.dependency, edge.edgeType, edge.sourceLine, edge.isTypeOnly, edge.specifier]);
  const edgeKeys = new Set(report.edges.map((edge) => edgeKey(edge.graphSide, edge.storedImport)));
  report.edges.forEach((edge, index) => {
    if (![edge.storedImport.importer, edge.storedImport.dependency].every((path) => nodeKeys.has(JSON.stringify([edge.graphSide, path])))) issue("Report edge endpoints must be nodes on the same side", ["edges", index]);
  });
  report.paths.forEach((path, index) => {
    const target = nodesById.get(path.targetNodeId);
    if (!target || target.graphSide !== path.graphSide || target.path !== path.paths.at(-1)) issue("Evidence target must match node and graph side", ["paths", index]);
    const root = report.nodes.find((node) => node.graphSide === path.graphSide && node.path === path.paths[0]);
    if (!root?.isChanged) issue("Evidence must start at a changed root on the same side", ["paths", index]);
    if (path.pathType === "shortest" && target && path.paths.length - 1 !== target.distance) issue("Shortest path length must equal target distance", ["paths", index]);
    if (path.evidence.some((edge) => !edgeKeys.has(edgeKey(path.graphSide, edge)))) issue("Path evidence must exist in this side's report graph", ["paths", index]);
  });
  report.testAssociations.forEach((association, index) => {
    const target = nodesById.get(association.targetNodeId);
    if (!target || target.graphSide !== association.graphSide) issue("Test association target must match graph side", ["testAssociations", index]);
  });
  for (const [field, keys] of [
    ["changes", report.changes.map((change) => change.path)],
    ["scoreFactors", report.scoreFactors.map((factor) => factor.factorKey)],
    ["paths", report.paths.map((path) => JSON.stringify([path.targetNodeId, path.pathType]))],
    ["testAssociations", report.testAssociations.map((association) => JSON.stringify([association.targetNodeId, association.testPath, association.associationType]))],
  ] as const) {
    if (new Set(keys).size !== keys.length) issue("Duplicate report relationship", [field]);
  }
});

export type ChangedFile = z.infer<typeof changedFileSchema>;
export type ImpactedNode = z.infer<typeof impactedNodeSchema>;
export type ReportGraphEdge = z.infer<typeof reportGraphEdgeSchema>;
export type EvidencePath = z.infer<typeof evidencePathSchema>;
export type TestAssociation = z.infer<typeof testAssociationSchema>;
export type ScoreFactor = z.infer<typeof scoreFactorSchema>;
export type AnalysisReport = z.infer<typeof analysisReportSchema>;
