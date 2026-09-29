/** Fixture-only syntax audit, not Faultline's production parser or resolver. No emit/evaluation. */
import { posix } from "node:path";
import ts from "typescript";
import type { RepositorySourceInput, ResolvedRelationship } from "../../types/domain/source.ts";

export function auditDemoStoreSources(snapshot: RepositorySourceInput) {
  const prefix = "/virtual-demo-store/";
  const sourceFiles = new Map(snapshot.files.map((file) => {
    const kind = file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : file.path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return [prefix + file.path, ts.createSourceFile(prefix + file.path, file.sourceText, ts.ScriptTarget.Latest, true, kind)];
  }));
  const options: ts.CompilerOptions = { noEmit: true, noResolve: true, noLib: true, allowJs: true, jsx: ts.JsxEmit.Preserve };
  const host: ts.CompilerHost = {
    getSourceFile: (path) => sourceFiles.get(path),
    getDefaultLibFileName: () => "", writeFile: () => { throw new Error("Fixture audit must never emit code"); },
    getCurrentDirectory: () => "/virtual-demo-store", getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: (path) => sourceFiles.has(path), readFile: (path) => sourceFiles.get(path)?.text,
  };
  // Program is used only for public syntactic diagnostics; no semantic checking or emit.
  const program = ts.createProgram([...sourceFiles.keys()], options, host);
  const paths = new Set(snapshot.files.map((file) => file.path));
  const relationships: ResolvedRelationship[] = [];
  const parseFailures: string[] = [];
  const missingImports: { importer: string; specifier: string }[] = [];

  for (const file of snapshot.files) {
    const source = sourceFiles.get(prefix + file.path)!;
    if (program.getSyntacticDiagnostics(source).length) { parseFailures.push(file.path); continue; }
    const add = (specifier: string, edgeType: ResolvedRelationship["edgeType"], node: ts.Node, isTypeOnly: boolean) => {
      if (!specifier.startsWith(".")) return; // External packages are deliberately outside this audit.
      const candidate = posix.normalize(posix.join(posix.dirname(file.path), specifier));
      const dependency = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}/index.ts`, `${candidate}/index.tsx`]
        .find((path) => paths.has(path));
      if (!dependency) { missingImports.push({ importer: file.path, specifier }); return; }
      relationships.push({ importer: file.path, dependency, specifier, edgeType, isTypeOnly,
        sourceLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text, "static_import", node, node.importClause?.isTypeOnly ?? false);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text, "re_export", node, node.isTypeOnly);
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0].text, "dynamic_import", node, false);
        else if (ts.isIdentifier(node.expression) && node.expression.text === "require") add(node.arguments[0].text, "require", node, false);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { graph: { files: [...paths], edges: relationships }, relationships, parseFailures, missingImports };
}
