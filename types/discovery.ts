import { z } from "zod";
import { repositoryPathSchema } from "./domain/primitives.ts";
import { sourceLimitsSchema } from "./domain/source.ts";
import type { ParseResult, ParserInput } from "./parser.ts";
import type { LocatedImportResolution } from "./resolver.ts";

export const analysisLimitsSchema = sourceLimitsSchema.extend({ maxChangedFiles: z.number().int().min(1).max(500) });
export type AnalysisLimits = z.infer<typeof analysisLimitsSchema>;
/** public.repositories defaults. CamelCase boundary; not another database schema. */
export const DEFAULT_ANALYSIS_LIMITS: Readonly<AnalysisLimits> = Object.freeze({
  maxSourceFiles: 300, maxChangedFiles: 100, maxFileBytes: 256000, maxTotalSourceBytes: 10485760,
});
export const treeEntrySchema = z.strictObject({
  path: repositoryPathSchema,
  kind: z.enum(["file", "directory", "symlink", "submodule"]),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  isBinary: z.boolean(),
});
export type RepositoryTreeEntry = z.infer<typeof treeEntrySchema>;
export interface RepositoryTree {
  readonly entries: readonly RepositoryTreeEntry[];
  readonly truncated: boolean;
}
export interface DiscoveryInput {
  readonly tree: RepositoryTree;
  /** Full PR diff paths, including removed/unsupported files; never last commit only. */
  readonly changedPaths: readonly string[];
  readonly limits?: AnalysisLimits;
}
export type InputFailure = {
  status: "invalid_input";
  code: "invalid_limits" | "invalid_tree" | "truncated_tree" | "duplicate_path" | "invalid_changed_paths" | "invalid_sources" | "size_mismatch";
  path?: string;
} | {
  status: "limit_exceeded";
  limit: keyof AnalysisLimits | "treeEntries" | "sourceEntries" | "relationships";
  maximum: number;
  path?: string;
};
export interface SkippedSource {
  readonly path: string;
  readonly reason: "binary" | "source_missing";
}
export interface DiscoveryCounts {
  readonly treeEntries: number;
  readonly excludedEntries: number;
  readonly discoveredRelevantFiles: number;
}
export type DiscoveryResult = InputFailure | {
  status: "ready";
  limits: AnalysisLimits;
  files: readonly RepositoryTreeEntry[];
  skipped: readonly SkippedSource[];
  counts: DiscoveryCounts;
};
export interface SourceAnalysisInput extends DiscoveryInput {
  readonly sources: readonly ParserInput[];
}
export interface SourceAnalysisCounts extends DiscoveryCounts {
  readonly parsedFiles: number;
  readonly failedFiles: number;
  readonly skippedFiles: number;
  readonly resolvedImports: number;
  readonly unresolvedLocalImports: number;
  readonly externalImports: number;
  readonly unsupportedRelationships: number;
  /** Extracted imports + parser unsupported records, only from successfully parsed files. */
  readonly observedRelationships: number;
}
export type SourceAnalysisResult = InputFailure | {
  status: "analyzed";
  counts: SourceAnalysisCounts;
  skipped: readonly SkippedSource[];
  files: readonly {
    path: string;
    parse: ParseResult;
    resolutions: readonly LocatedImportResolution[];
  }[];
};
