import { parse, TSError } from "@typescript-eslint/typescript-estree";
import { repositoryPathSchema } from "../../types/domain/primitives.ts";
import type { ParseDiagnostic, ParseResult, ParserInput } from "../../types/parser.ts";
import { extractSyntax, ParserBoundaryError } from "./parser/extract.ts";
import { sourceSyntax } from "./source-policy.ts";

const MAX_SOURCE_BYTES = 1048576;

function failure(code: ParseDiagnostic["code"], message: string, location: ParseDiagnostic["location"] = null): ParseResult {
  return { status: "failed", diagnostic: { code, message, location } };
}

/** Node/server syntax boundary. No project, resolution, I/O, execution or type checking. */
export function parseSource(input: ParserInput): ParseResult {
  if (!input || !repositoryPathSchema.safeParse(input.path).success || typeof input.sourceText !== "string") {
    return failure("invalid_input", "Expected a canonical repository path and supplied source text.");
  }
  const syntax = sourceSyntax(input.path);
  if (!syntax) return failure("unsupported_extension", "Expected a TypeScript or JavaScript source extension.");
  if (input.sourceText.length > MAX_SOURCE_BYTES || new TextEncoder().encode(input.sourceText).length > MAX_SOURCE_BYTES) {
    return failure("source_too_large", "Source exceeds the parser's 1 MiB UTF-8 limit.");
  }
  try {
    // filePath selects syntax only. parse() creates a SourceFile, never a Program.
    // A fixed virtual name avoids passing repository paths into library diagnostics.
    const ast = parse(input.sourceText, {
      filePath: `faultline-input${input.path.slice(input.path.lastIndexOf(".")).toLowerCase()}`,
      jsx: syntax === "tsx" || syntax === "jsx",
      sourceType: "module",
      project: false,
      projectService: false,
      loc: true,
      range: true,
      comment: false,
      tokens: false,
      jsDocParsingMode: "none",
      loggerFn: false,
      errorOnUnknownASTType: true,
    });
    return { status: "parsed", syntax, ...extractSyntax(ast, syntax) };
  } catch (error: unknown) {
    if (error instanceof ParserBoundaryError) return failure(error.code, error.message, error.location);
    if (error instanceof TSError) {
      // Deliberately do not copy message, stack, filename or source from the exception.
      const { start, end } = error.location;
      return failure("syntax_error", "Invalid source syntax; inspect the indicated location.", {
        start: { offset: start.offset, line: start.line, column: start.column },
        end: { offset: end.offset, line: end.line, column: end.column },
      });
    }
    return failure("parser_failure", "Syntax parsing could not complete for this file.");
  }
}
