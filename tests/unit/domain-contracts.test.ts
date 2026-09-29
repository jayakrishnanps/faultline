import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisStatusSchema, publishingStatusSchema, snapshotStatusSchema, graphSideSchema, repositoryIdSchema, githubNumericIdSchema, repositoryPathSchema } from "../../types/domain/primitives.ts";
import type { GitHubNumericId, RepositoryId } from "../../types/domain/primitives.ts";
import { extractedImportSchema, importResolutionSchema, repositorySourceInputSchema, sourceFileSchema } from "../../types/domain/source.ts";
import { graphSnapshotSchema, completenessSchema } from "../../types/domain/snapshot.ts";
import { analysisReportSchema, changedFileSchema, evidencePathSchema, reportGraphEdgeSchema, scoreFactorSchema, testAssociationSchema } from "../../types/domain/report.ts";
import { evidencePathFromRow, evidencePathToInsert, sourceFileFromRow, sourceFileToInsert } from "../../lib/data/domain-conversions.ts";
import type { Database } from "../../types/database.ts";

type Assert<T extends true> = T;
export type DistinctIdentityCheck = Assert<GitHubNumericId extends RepositoryId ? false : true>;
export type GeneratedPathLengthCheck = Assert<Exclude<Database["public"]["Tables"]["impact_paths"]["Insert"]["path_length"], undefined> extends never ? true : false>;

const repositoryId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";
const analysisId = "33333333-3333-4333-8333-333333333333";
const rootId = "44444444-4444-4444-8444-444444444444";
const targetId = "55555555-5555-4555-8555-555555555555";
const sha = "a".repeat(40);
const completedAt = "2026-09-29T00:00:00Z";
const snapshot = { id: snapshotId, repositoryId, commitSha: sha, indexVersion: "v1", status: "ready", completedAt };
const completeness = { filesTotal: 2, filesParsed: 2, filesFailed: 0, filesSkipped: 0, importsResolved: 1, importsUnresolved: 0, traversalTruncated: false, warnings: [] };
const syntax = { specifier: "./a", edgeType: "static_import", sourceLine: 7, isTypeOnly: true };
const relationship = { ...syntax, importer: "b.ts", dependency: "a.ts" };
const root = { id: rootId, graphSide: "head", path: "a.ts", fileType: "module", distance: 0, isChanged: true, isEntryPoint: false, isTest: false, isSensitive: false, routePath: null, owners: [], reason: "changed", evidence: {} };
const target = { ...root, id: targetId, path: "b.ts", distance: 1, isChanged: false, reason: "dependent" };
const path = { targetNodeId: targetId, graphSide: "head", pathType: "shortest", paths: ["a.ts", "b.ts"], evidence: [relationship] };
const edge = { graphSide: "head", storedImport: relationship, displayedImpact: { from: "a.ts", to: "b.ts" } };
const file = { id: rootId, path: "a.ts", contentSha: sha, language: "typescript", fileType: "module", sizeBytes: 30, isEntryPoint: false, isTest: false, routePath: null, parseStatus: "parsed", parseError: null, imports: [syntax], unresolvedImports: [], exportedNames: ["A"] };
const report = {
  contractVersion: 1, id: analysisId, repositoryId, pullRequestId: rootId,
  headSha: sha, baseSha: "b".repeat(40), comparisonBaseSha: null,
  analyzerVersion: "v1", configurationVersion: 1, status: "complete", publishingStatus: "pending",
  stage: "complete", progress: 100, impactScore: 10, completedAt,
  snapshots: { head: snapshot, base: null }, completeness,
  counts: { changed: 1, direct: 1, indirect: 0, reachable: 1, entryPoints: 0, tests: 0, testGaps: 0 },
  changes: [{ path: "a.ts", previousPath: null, changeType: "modified", additions: 1, deletions: 0, isSupported: true, skipReason: null }],
  nodes: [root, target], edges: [edge], paths: [path], testAssociations: [], scoreFactors: [],
};

test("SQL analysis, publishing, snapshot and side values remain separate", () => {
  for (const status of ["queued", "indexing", "analyzing", "complete", "partial", "failed", "superseded", "cancelled"]) assert.equal(analysisStatusSchema.parse(status), status);
  for (const status of ["pending", "publishing", "published", "failed", "skipped"]) assert.equal(publishingStatusSchema.parse(status), status);
  for (const status of ["done", "published", "running", "COMPLETE"]) assert.equal(analysisStatusSchema.safeParse(status).success, false);
  assert.equal(publishingStatusSchema.safeParse("complete").success, false);
  assert.equal(snapshotStatusSchema.safeParse("partial").success, false);
  assert.equal(graphSideSchema.safeParse("baseline").success, false);
  assert.equal(graphSideSchema.parse("base"), "base");
  assert.equal(analysisReportSchema.safeParse({ ...report, status: "published" }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, publishingStatus: "complete" }).success, false);
});

test("IDs reject coercion and unsafe numeric precision; paths reject escapes", () => {
  assert.equal(repositoryIdSchema.safeParse(123).success, false);
  for (const value of [repositoryId, "123", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(githubNumericIdSchema.safeParse(value).success, false);
  assert.equal(githubNumericIdSchema.parse(123), 123);
  for (const value of ["../a.ts", "/a.ts", "C:/a.ts", "a\\b.ts", "a//b.ts", "./a.ts", "a\0.ts"]) assert.equal(repositoryPathSchema.safeParse(value).success, false);
});

test("source input enforces UTF-8 and aggregate byte limits, unique paths, and remains inert", () => {
  const input = { repositoryId, commitSha: sha, indexVersion: "v1", limits: { maxSourceFiles: 2, maxFileBytes: 1024, maxTotalSourceBytes: 1024 }, files: [{ path: "a.ts", contentSha: sha, language: "typescript", sourceText: "throw new Error('never execute');" }] };
  assert.equal(repositorySourceInputSchema.parse(input).files[0]?.sourceText, input.files[0]?.sourceText);
  assert.equal(repositorySourceInputSchema.safeParse({ ...input, files: [input.files[0], input.files[0]] }).success, false);
  assert.equal(repositorySourceInputSchema.safeParse({ ...input, files: [{ ...input.files[0], sourceText: "é".repeat(513) }] }).success, false);
  assert.equal(repositorySourceInputSchema.safeParse({ ...input, files: [{ ...input.files[0], sourceText: "x".repeat(600) }, { ...input.files[0], path: "b.ts", sourceText: "x".repeat(600) }] }).success, false);
});

test("imports retain line and type-only evidence and use discriminated resolution", () => {
  assert.deepEqual(extractedImportSchema.parse(syntax), syntax);
  assert.equal(extractedImportSchema.safeParse({ ...syntax, sourceLine: 0 }).success, false);
  assert.equal(extractedImportSchema.safeParse({ ...syntax, isTypeOnly: "true" }).success, false);
  assert.equal(importResolutionSchema.safeParse({ status: "resolved", relationship }).success, true);
  assert.equal(importResolutionSchema.safeParse({ status: "unresolved", importer: "b.ts", import: { ...syntax, reason: "not_found" } }).success, true);
  assert.equal(importResolutionSchema.safeParse({ status: "resolved", import: syntax }).success, false);
});

test("snapshots reject foreign endpoints, duplicate files and incomplete ready state", () => {
  const graph = { ...snapshot, completeness, files: [file, { ...file, id: targetId, path: "b.ts" }], edges: [relationship] };
  assert.equal(graphSnapshotSchema.safeParse(graph).success, true);
  assert.equal(graphSnapshotSchema.safeParse({ ...graph, completedAt: null }).success, false);
  assert.equal(graphSnapshotSchema.safeParse({ ...graph, files: [file, file] }).success, false);
  assert.equal(graphSnapshotSchema.safeParse({ ...graph, edges: [{ ...relationship, dependency: "missing.ts" }] }).success, false);
  assert.equal(completenessSchema.safeParse({ ...completeness, filesFailed: 1 }).success, false);
});

test("report rejects mixed revisions, mismatched evidence and import-direction display", () => {
  assert.equal(analysisReportSchema.safeParse(report).success, true);
  assert.equal(analysisReportSchema.safeParse({ ...report, snapshots: { head: { ...snapshot, commitSha: report.baseSha }, base: null } }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, snapshots: { head: null, base: null } }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, paths: [{ ...path, graphSide: "base" }] }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, paths: [{ ...path, targetNodeId: rootId }] }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, edges: [] }).success, false);
  assert.equal(reportGraphEdgeSchema.safeParse({ ...edge, displayedImpact: { from: "b.ts", to: "a.ts" } }).success, false);
  assert.equal(evidencePathSchema.safeParse({ ...path, paths: ["b.ts", "a.ts"] }).success, false);
});

test("base evidence uses the comparison commit and separate node identities", () => {
  const comparisonSha = "c".repeat(40);
  const baseReport = {
    ...report, comparisonBaseSha: comparisonSha,
    snapshots: { head: snapshot, base: { ...snapshot, id: targetId, commitSha: comparisonSha } },
    nodes: report.nodes.map((node) => ({ ...node, graphSide: "base" })),
    edges: [{ ...edge, graphSide: "base" }], paths: [{ ...path, graphSide: "base" }],
  };
  assert.equal(analysisReportSchema.safeParse(baseReport).success, true);
  assert.equal(analysisReportSchema.safeParse({ ...baseReport, snapshots: { ...baseReport.snapshots, base: { ...baseReport.snapshots.base, commitSha: report.baseSha } } }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...baseReport, testAssociations: [{ targetNodeId: targetId, graphSide: "head", testPath: "a.test.ts", associationType: "filename", evidence: {} }] }).success, false);
});

test("changed files, score factors and associations reject invalid semantics and arbitrary JSON", () => {
  assert.equal(changedFileSchema.safeParse({ ...report.changes[0], changeType: "renamed" }).success, false);
  assert.equal(changedFileSchema.safeParse({ ...report.changes[0], changeType: "removed" }).success, true);
  assert.equal(scoreFactorSchema.safeParse({ factorKey: "reach", label: "Reach", points: 101, evidence: {} }).success, false);
  assert.equal(scoreFactorSchema.safeParse({ factorKey: "reach", label: "Reach", points: 10, evidence: { sourceText: "secret" } }).success, false);
  assert.equal(testAssociationSchema.safeParse({ targetNodeId: targetId, graphSide: "head", testPath: "a.test.ts", associationType: "coverage", evidence: {} }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...report, rawWebhookBody: "payload" }).success, false);
  assert.equal(sourceFileSchema.safeParse({ ...file, isSensitive: true }).success, false);
});

test("source conversion validates stored JSON and scope, preserving provenance without sensitivity", () => {
  const insert = sourceFileToInsert(file, { ...snapshot, status: "indexing", completedAt: null });
  assert.equal("is_sensitive" in insert, false);
  const row: Database["public"]["Tables"]["source_files"]["Row"] = {
    id: rootId, repository_id: repositoryId, snapshot_id: snapshotId,
    path: "a.ts", content_sha: sha, language: "typescript", file_type: "module", size_bytes: 30,
    is_entry_point: false, is_test: false, route_path: null, parse_status: "parsed", parse_error: null,
    imports: [syntax], unresolved_imports: [], exported_names: ["A"], created_at: completedAt,
  };
  assert.deepEqual(sourceFileFromRow(row, snapshot), file);
  assert.throws(() => sourceFileFromRow({ ...row, imports: [{ arbitrary: true }] }, snapshot));
  assert.throws(() => sourceFileFromRow({ ...row, snapshot_id: rootId }, snapshot));
  assert.throws(() => sourceFileToInsert(file, snapshot), /indexing/);
});

test("impact inserts omit generated path_length and reject mismatched targets", () => {
  const scope = { analysisId, repositoryId };
  const insert = evidencePathToInsert(path, scope, target);
  assert.equal("path_length" in insert, false);
  assert.deepEqual(insert.path_json, ["a.ts", "b.ts"]);
  assert.deepEqual(insert.evidence, [relationship]);
  assert.throws(() => evidencePathToInsert({ ...path, path_length: 1 }, scope, target));
  assert.throws(() => evidencePathToInsert(path, scope, root), /target/);
  const row: Database["public"]["Tables"]["impact_paths"]["Row"] = {
    id: snapshotId, analysis_id: analysisId, repository_id: repositoryId,
    target_node_id: targetId, graph_side: "head", path_type: "shortest",
    path_json: path.paths, path_length: 1, evidence: [relationship],
  };
  assert.deepEqual(evidencePathFromRow(row, scope, target), path);
  assert.throws(() => evidencePathFromRow({ ...row, path_length: 2 }, scope, target), /length/);
  assert.throws(() => evidencePathFromRow({ ...row, repository_id: rootId }, scope, target), /repository/);
  assert.throws(() => evidencePathFromRow({ ...row, path_json: [123] }, scope, target));
});
