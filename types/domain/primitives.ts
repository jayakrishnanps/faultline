import { z } from "zod";

/** SQL text CHECK values live here, not in presentation components. */
export const graphSideSchema = z.enum(["head", "base"]);
export const analysisStatusSchema = z.enum(["queued", "indexing", "analyzing", "complete", "partial", "failed", "superseded", "cancelled"]);
export const publishingStatusSchema = z.enum(["pending", "publishing", "published", "failed", "skipped"]);
export const snapshotStatusSchema = z.enum(["indexing", "ready", "failed"]);
export const repositoryIndexStatusSchema = z.enum(["not_indexed", "queued", "indexing", "ready", "partial", "failed", "too_large"]);
export const languageSchema = z.enum(["typescript", "javascript", "json", "other"]);
export const fileTypeSchema = z.enum(["module", "page", "api_route", "layout", "middleware", "test", "config", "job", "other"]);
export const parseStatusSchema = z.enum(["parsed", "failed", "skipped"]);
export const edgeTypeSchema = z.enum(["static_import", "dynamic_import", "re_export", "require"]);
export const changeTypeSchema = z.enum(["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"]);
export const pathTypeSchema = z.enum(["shortest", "entry_point", "test", "sensitive"]);
export const associationTypeSchema = z.enum(["dependency_path", "filename", "proximity"]);

export const repositoryIdSchema = z.uuid().brand<"RepositoryId">();
export const snapshotIdSchema = z.uuid().brand<"SnapshotId">();
export const sourceFileIdSchema = z.uuid().brand<"SourceFileId">();
export const analysisIdSchema = z.uuid().brand<"AnalysisId">();
export const pullRequestIdSchema = z.uuid().brand<"PullRequestId">();
export const analysisNodeIdSchema = z.uuid().brand<"AnalysisNodeId">();
// SQL bigint may exceed JS precision. Reject such values, never round or coerce.
export const githubNumericIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).brand<"GitHubNumericId">();
export const shaSchema = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/);
export const countSchema = z.number().int().min(0).max(2147483647);
export const percentageSchema = z.number().int().min(0).max(100);
export const sourceLineSchema = countSchema.min(1);
export const timestampSchema = z.iso.datetime({ offset: true });
export const labelSchema = z.string().min(1).max(2000);

/** Deliberately stricter than SQL: canonical, repository-relative POSIX paths. */
export const repositoryPathSchema = z.string().min(1).max(4096).refine(
  (path) => !/[\\\u0000-\u001f\u007f:]/.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  "Expected a canonical repository-relative POSIX path",
);

/** Structural allowlist, not arbitrary JSON or a secret-detection mechanism. */
export const structuralEvidenceSchema = z.strictObject({
  paths: z.array(repositoryPathSchema).max(1000).optional(),
  sourceLines: z.array(sourceLineSchema).max(1000).optional(),
  count: countSchema.optional(),
  rule: z.string().min(1).max(200).optional(),
});
export const warningSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  path: repositoryPathSchema.optional(),
});

export type GraphSide = z.infer<typeof graphSideSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type PublishingStatus = z.infer<typeof publishingStatusSchema>;
export type RepositoryId = z.infer<typeof repositoryIdSchema>;
export type GitHubNumericId = z.infer<typeof githubNumericIdSchema>;
export type SnapshotId = z.infer<typeof snapshotIdSchema>;
export type SourceFileId = z.infer<typeof sourceFileIdSchema>;
export type AnalysisId = z.infer<typeof analysisIdSchema>;
export type PullRequestId = z.infer<typeof pullRequestIdSchema>;
export type AnalysisNodeId = z.infer<typeof analysisNodeIdSchema>;
export type SnapshotStatus = z.infer<typeof snapshotStatusSchema>;
export type RepositoryIndexStatus = z.infer<typeof repositoryIndexStatusSchema>;
export type Language = z.infer<typeof languageSchema>;
export type FileType = z.infer<typeof fileTypeSchema>;
export type ParseStatus = z.infer<typeof parseStatusSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type ChangeType = z.infer<typeof changeTypeSchema>;
export type PathType = z.infer<typeof pathTypeSchema>;
export type AssociationType = z.infer<typeof associationTypeSchema>;
export type StructuralEvidence = z.infer<typeof structuralEvidenceSchema>;
