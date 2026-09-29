/** Pure conversions only: no client construction, authorization or database I/O. */
import { z } from "zod";
import type { Database } from "../../types/database.ts";
import { analysisIdSchema, repositoryIdSchema } from "../../types/domain/primitives.ts";
import { evidencePathSchema, impactedNodeSchema } from "../../types/domain/report.ts";
import { snapshotReferenceSchema } from "../../types/domain/snapshot.ts";
import { sourceFileSchema } from "../../types/domain/source.ts";

type Tables = Database["public"]["Tables"];
export const analysisScopeSchema = z.strictObject({
  analysisId: analysisIdSchema,
  repositoryId: repositoryIdSchema,
});

export function sourceFileFromRow(row: Tables["source_files"]["Row"], snapshotInput: unknown) {
  const snapshot = snapshotReferenceSchema.parse(snapshotInput);
  if (row.repository_id !== snapshot.repositoryId || row.snapshot_id !== snapshot.id) {
    throw new Error("Source row does not belong to the requested repository snapshot");
  }
  // In particular, imports/unresolved_imports/exported_names are still untrusted Json.
  return sourceFileSchema.parse({
    id: row.id, path: row.path, contentSha: row.content_sha, language: row.language,
    fileType: row.file_type, sizeBytes: row.size_bytes, isEntryPoint: row.is_entry_point,
    isTest: row.is_test, routePath: row.route_path, parseStatus: row.parse_status,
    parseError: row.parse_error, imports: row.imports,
    unresolvedImports: row.unresolved_imports, exportedNames: row.exported_names,
  });
}

export function sourceFileToInsert(input: unknown, snapshotInput: unknown): Tables["source_files"]["Insert"] {
  const file = sourceFileSchema.parse(input);
  const snapshot = snapshotReferenceSchema.parse(snapshotInput);
  if (snapshot.status !== "indexing") throw new Error("Source writes require an indexing snapshot");
  return {
    id: file.id, repository_id: snapshot.repositoryId, snapshot_id: snapshot.id,
    path: file.path, content_sha: file.contentSha, language: file.language,
    file_type: file.fileType, size_bytes: file.sizeBytes, is_entry_point: file.isEntryPoint,
    is_test: file.isTest, route_path: file.routePath, parse_status: file.parseStatus,
    parse_error: file.parseError, imports: file.imports,
    unresolved_imports: file.unresolvedImports, exported_names: file.exportedNames,
  };
}

export function evidencePathToInsert(input: unknown, scopeInput: unknown, targetInput: unknown): Tables["impact_paths"]["Insert"] {
  const path = evidencePathSchema.parse(input);
  const scope = analysisScopeSchema.parse(scopeInput);
  const target = impactedNodeSchema.parse(targetInput);
  if (path.targetNodeId !== target.id || path.graphSide !== target.graphSide || path.paths.at(-1) !== target.path) {
    throw new Error("Evidence target must match the node and graph side");
  }
  // No object spreading: only allowlisted columns; PostgreSQL generates path_length.
  return {
    analysis_id: scope.analysisId, repository_id: scope.repositoryId,
    target_node_id: path.targetNodeId, graph_side: path.graphSide,
    path_type: path.pathType, path_json: path.paths, evidence: path.evidence,
  };
}

export function evidencePathFromRow(row: Tables["impact_paths"]["Row"], scopeInput: unknown, targetInput: unknown) {
  const scope = analysisScopeSchema.parse(scopeInput);
  if (row.analysis_id !== scope.analysisId || row.repository_id !== scope.repositoryId) {
    throw new Error("Evidence row does not belong to the requested analysis repository");
  }
  const path = evidencePathSchema.parse({
    targetNodeId: row.target_node_id, graphSide: row.graph_side, pathType: row.path_type,
    paths: row.path_json, evidence: row.evidence,
  });
  // Reuse target checks; constructing an insert object does not write anything.
  evidencePathToInsert(path, scope, targetInput);
  if (row.path_length !== path.paths.length - 1) throw new Error("Generated path length does not match stored evidence");
  return path;
}
