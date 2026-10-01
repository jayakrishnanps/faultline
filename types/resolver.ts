import type { ImportResolution } from "./domain/source.ts";
import type { SourceSpan } from "./parser.ts";

export interface RepositoryFileIndex {
  /** Case-sensitive, canonical repository paths only; no filesystem access. */
  has(path: string): boolean;
}
export type FileIndexResult = { status: "ready"; index: RepositoryFileIndex }
  | { status: "invalid"; code: "invalid_path" | "duplicate_path" | "too_many_paths" };

/** Envelope preserves parser provenance without changing the strict domain union. */
export interface LocatedImportResolution {
  readonly resolution: ImportResolution;
  readonly location: SourceSpan;
  readonly detail: "unsupported_alias" | "unsupported_specifier" | "unsupported_extension" | null;
  readonly candidates: readonly string[];
}
export type ImportResolutionResult = LocatedImportResolution | {
  status: "invalid_input";
  code: "invalid_importer";
};
