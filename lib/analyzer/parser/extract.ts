/** Parser implementation detail: ESTree never crosses the public parser boundary. */
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { visitorKeys } from "@typescript-eslint/visitor-keys";
import { extractedImportSchema } from "../../../types/domain/source.ts";
import type { ExtractedImport } from "../../../types/domain/source.ts";
import type { ParseDiagnostic, ParsedImport, SourceSpan, SourceSyntax, UnsupportedSyntax } from "../../../types/parser.ts";

const MAX_NODES = 100000;
const MAX_IMPORTS = 10000;
const MAX_EXPORTS = 10000;
const MAX_UNSUPPORTED = 100;

export class ParserBoundaryError extends Error {
  constructor(readonly code: "structure_limit" | "syntax_mismatch", message: string, readonly location: ParseDiagnostic["location"]) {
    super(message);
  }
}

function span(node: TSESTree.Node): SourceSpan {
  return {
    start: { offset: node.range[0], ...node.loc.start },
    end: { offset: node.range[1], ...node.loc.end },
  };
}

/** Fixed visitor keys omit comments/tokens/metadata and follow every nested expression. */
function children(node: TSESTree.Node): TSESTree.Node[] {
  const result: TSESTree.Node[] = [];
  for (const key of visitorKeys[node.type] ?? []) {
    // The key table and node come from the same pinned AST library version.
    const value: unknown = (node as unknown as Record<string, unknown>)[key];
    const candidates = Array.isArray(value) ? value : [value];
    for (const child of candidates) {
      if (child && typeof child === "object" && "type" in child && typeof child.type === "string") {
        result.push(child as TSESTree.Node);
      }
    }
  }
  return result;
}

function exportedName(node: TSESTree.Identifier | TSESTree.StringLiteral): string {
  return node.type === "Identifier" ? node.name : node.value;
}

/** Only binding positions count, never object keys or identifiers in initializers. */
function bindingNames(pattern: TSESTree.Node): string[] {
  switch (pattern.type) {
    case "Identifier": return [pattern.name];
    case "ArrayPattern": return pattern.elements.flatMap((element) => element ? bindingNames(element) : []);
    case "ObjectPattern": return pattern.properties.flatMap((property) => bindingNames(property.type === "RestElement" ? property.argument : property.value));
    case "AssignmentPattern": return bindingNames(pattern.left);
    case "RestElement": return bindingNames(pattern.argument);
    default: return [];
  }
}

function declarationNames(declaration: TSESTree.Node): string[] {
  if (declaration.type === "VariableDeclaration") return declaration.declarations.flatMap((item) => bindingNames(item.id));
  if ("id" in declaration && declaration.id?.type === "Identifier") return [declaration.id.name];
  return [];
}

export function extractSyntax(ast: TSESTree.Program, syntax: SourceSyntax) {
  const imports: ParsedImport[] = [];
  const unsupported: UnsupportedSyntax[] = [];
  const names = new Set<string>();
  const limit = (node: TSESTree.Node) => { throw new ParserBoundaryError("structure_limit", "Source exceeds the parser's structural extraction limits.", span(node)); };
  const warn = (code: UnsupportedSyntax["code"], node: TSESTree.Node) => {
    if (unsupported.length >= MAX_UNSUPPORTED) limit(node);
    unsupported.push({ code, location: span(node) });
  };
  const add = (value: string, edgeType: ExtractedImport["edgeType"], node: TSESTree.Node, isTypeOnly: boolean) => {
    const result = extractedImportSchema.safeParse({ specifier: value, edgeType, sourceLine: node.loc.start.line, isTypeOnly });
    if (!result.success) { warn("invalid_specifier", node); return; }
    if (imports.length >= MAX_IMPORTS) limit(node);
    imports.push({ import: result.data, location: span(node) });
  };

  // Exported names are the module's own surface, not exports inside namespaces.
  for (const statement of ast.body) {
    let declared: string[] = [];
    if (statement.type === "ExportDefaultDeclaration") declared = ["default"];
    else if (statement.type === "ExportAllDeclaration" && statement.exported) declared = [exportedName(statement.exported)];
    else if (statement.type === "ExportNamedDeclaration") {
      declared = statement.declaration ? declarationNames(statement.declaration) : statement.specifiers.map((item) => exportedName(item.exported));
    }
    for (const name of declared) {
      if (!name.length || name.length > 4096 || (!names.has(name) && names.size >= MAX_EXPORTS)) limit(statement);
      names.add(name);
    }
  }

  const stack: TSESTree.Node[] = [ast];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > MAX_NODES) limit(node);
    // ESTree's TS grammar is permissive for JS; enforce the requested file mode.
    const javascript = syntax === "js" || syntax === "jsx";
    if ((javascript && (node.type.startsWith("TS") || ("importKind" in node && node.importKind === "type") || ("exportKind" in node && node.exportKind === "type")))
      || ((syntax === "ts" || syntax === "js") && node.type.startsWith("JSX"))) {
      throw new ParserBoundaryError("syntax_mismatch", "Source syntax does not match the file extension.", span(node));
    }
    switch (node.type) {
      case "ImportDeclaration":
        add(node.source.value, "static_import", node, node.importKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((item) => item.type === "ImportSpecifier" && item.importKind === "type")));
        break;
      case "ExportNamedDeclaration":
        if (node.source) add(node.source.value, "re_export", node, node.exportKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((item) => item.exportKind === "type")));
        break;
      case "ExportAllDeclaration":
        add(node.source.value, "re_export", node, node.exportKind === "type");
        break;
      case "ImportExpression":
        if (node.source.type === "Literal" && typeof node.source.value === "string") add(node.source.value, "dynamic_import", node, false);
        else warn("computed_dynamic_import", node);
        break;
      case "CallExpression":
        // No guessed edges, even for a literal: require may be locally shadowed.
        if (node.callee.type === "Identifier" && node.callee.name === "require") warn("require_not_analyzed", node);
        break;
      case "TSImportEqualsDeclaration": warn("import_equals_not_analyzed", node); break;
      case "TSImportType": warn("import_type_not_analyzed", node); break;
    }
    const nested = children(node);
    // Reverse push preserves the library's ordered child traversal without recursion.
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]!);
  }
  imports.sort((a, b) => a.location.start.offset - b.location.start.offset);
  unsupported.sort((a, b) => a.location.start.offset - b.location.start.offset);
  return { imports, exportedNames: [...names].sort(), unsupported };
}
