import { z } from "zod";
import { countSchema, repositoryIdSchema, shaSchema, snapshotIdSchema, snapshotStatusSchema, timestampSchema, warningSchema } from "./primitives.ts";
import { resolvedRelationshipSchema, sourceFileSchema } from "./source.ts";

export const completenessSchema = z.strictObject({
  filesTotal: countSchema,
  filesParsed: countSchema,
  filesFailed: countSchema,
  // Analyses has no files_skipped column: null means unavailable, not zero.
  filesSkipped: countSchema.nullable(),
  importsResolved: countSchema,
  importsUnresolved: countSchema,
  traversalTruncated: z.boolean(),
  warnings: z.array(warningSchema).max(1000),
}).refine((value) => value.filesParsed + value.filesFailed + (value.filesSkipped ?? 0) <= value.filesTotal,
  { message: "File outcome counts exceed total", path: ["filesTotal"] });

export const snapshotReferenceSchema = z.strictObject({
  id: snapshotIdSchema,
  repositoryId: repositoryIdSchema,
  commitSha: shaSchema,
  indexVersion: z.string().min(1).max(200),
  status: snapshotStatusSchema,
  completedAt: timestampSchema.nullable(),
}).refine((value) => value.status !== "ready" || value.completedAt !== null,
  { message: "Ready snapshots require completion time", path: ["completedAt"] });

export const graphSnapshotSchema = z.strictObject({
  ...snapshotReferenceSchema.shape,
  completeness: completenessSchema,
  files: z.array(sourceFileSchema).max(1000),
  edges: z.array(resolvedRelationshipSchema).max(100000),
}).superRefine((snapshot, ctx) => {
  if (snapshot.status === "ready" && snapshot.completedAt === null) ctx.addIssue({ code: "custom", message: "Ready snapshots require completion time", path: ["completedAt"] });
  const paths = new Set(snapshot.files.map((file) => file.path));
  const ids = new Set(snapshot.files.map((file) => file.id));
  if (paths.size !== snapshot.files.length || ids.size !== snapshot.files.length) ctx.addIssue({ code: "custom", message: "Snapshot file paths and IDs must be unique", path: ["files"] });
  const keys = new Set<string>();
  snapshot.edges.forEach((edge, index) => {
    if (!paths.has(edge.importer) || !paths.has(edge.dependency)) ctx.addIssue({ code: "custom", message: "Edge endpoints must belong to this snapshot", path: ["edges", index] });
    const key = JSON.stringify([edge.importer, edge.dependency, edge.edgeType, edge.sourceLine, edge.isTypeOnly]);
    if (keys.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate dependency edge", path: ["edges", index] });
    keys.add(key);
  });
});

export type Completeness = z.infer<typeof completenessSchema>;
export type SnapshotReference = z.infer<typeof snapshotReferenceSchema>;
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
