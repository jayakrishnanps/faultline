import type { ExtractedImport, SourceInput } from "./domain/source.ts";

/** Source is supplied by a trusted caller, never fetched by the parser. */
export type ParserInput = Pick<SourceInput, "path" | "sourceText">;
export type SourceSyntax = "ts" | "tsx" | "js" | "jsx";

/** UTF-16 offsets/columns, one-based lines, exclusive end; never source snippets. */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}
export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}
export interface ParsedImport {
  /** Fits extractedImportSchema unchanged; location stays outside persisted JSON. */
  readonly import: ExtractedImport;
  readonly location: SourceSpan;
}
export interface UnsupportedSyntax {
  readonly code: "computed_dynamic_import" | "require_not_analyzed" | "import_equals_not_analyzed" | "import_type_not_analyzed" | "invalid_specifier";
  readonly location: SourceSpan;
}
export interface ParseDiagnostic {
  readonly code: "invalid_input" | "unsupported_extension" | "source_too_large" | "syntax_error" | "syntax_mismatch" | "structure_limit" | "parser_failure";
  /** Fixed, bounded text: never the parser's raw exception or offending source. */
  readonly message: string;
  readonly location: SourceSpan | null;
}
export type ParseResult = {
  readonly status: "parsed";
  readonly syntax: SourceSyntax;
  readonly imports: readonly ParsedImport[];
  /** Only explicitly declared names. export * names require later resolution. */
  readonly exportedNames: readonly string[];
  readonly unsupported: readonly UnsupportedSyntax[];
} | {
  readonly status: "failed";
  readonly diagnostic: ParseDiagnostic;
};
