import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import { parseSource } from "../../lib/analyzer/parser.ts";
import { extractedImportSchema } from "../../types/domain/source.ts";
import type { ParseResult } from "../../types/parser.ts";
import { loadDemoStore } from "../../fixtures/demo-store/loader.ts";

const fixture = (path: string) => readFile(new URL(`../../fixtures/parser/${path}.fixture`, import.meta.url), "utf8");
function parsed(result: ParseResult) {
  assert.equal(result.status, "parsed", JSON.stringify(result));
  if (result.status !== "parsed") throw new Error("Expected parsed result");
  return result;
}

test.each([
  ["relationships.ts", "ts"], ["view.tsx", "tsx"], ["module.js", "js"], ["view.jsx", "jsx"],
])("parses supplied %s text using its actual extension", async (path, syntax) => {
  const result = parsed(parseSource({ path, sourceText: await fixture(path) }));
  assert.equal(result.syntax, syntax);
  assert.ok(result.imports.length > 0);
  for (const entry of result.imports) assert.equal(extractedImportSchema.safeParse(entry.import).success, true);
});

test("records multiline aliases, re-exports and type-only versus mixed declarations", async () => {
  const sourceText = (await fixture("relationships.ts")).replaceAll("\r\n", "\n");
  const result = parsed(parseSource({ path: "src/relationships.ts", sourceText }));
  assert.deepEqual(result.imports.map(({ import: entry }) => [entry.specifier, entry.edgeType, entry.isTypeOnly]), [
    ["./mixed", "static_import", false], ["./all-types", "static_import", true],
    ["./types", "static_import", true], ["./side-effect", "static_import", false],
    ["./mixed", "re_export", false], ["./types", "re_export", true], ["./all-types", "re_export", true],
    ["./barrel", "re_export", false], ["./tools", "re_export", false], ["./type-barrel", "re_export", true],
    ["./lazy", "dynamic_import", false],
  ]);
  const first = result.imports[0]!;
  assert.equal(first.import.sourceLine, 4);
  assert.deepEqual(first.location.start, { line: 4, column: 0, offset: sourceText.indexOf("import Default") });
  assert.equal(first.location.end.line, 7);
  assert.equal(sourceText.slice(first.location.start.offset, first.location.end.offset), "import Default, {\n  type Shape as LocalShape,\n  value as renamed\n} from './mixed';");
  assert.deepEqual(result.exportedNames, ["Only", "PublicShape", "Shape", "default", "exposed", "item", "load", "publicValue", "rest", "tools"]);
  assert.deepEqual(result.unsupported.map((entry) => entry.code), ["computed_dynamic_import", "computed_dynamic_import"]);
});

test("finds deeply nested imports in methods, defaults, callbacks and JSX expressions", () => {
  const sourceText = `class C { async method(arg = () => import('./default')) {
    return () => ({ task: async () => import('./nested') });
  } } const node = <div render={() => import('./jsx')} />;`;
  const result = parsed(parseSource({ path: "nested.tsx", sourceText }));
  assert.deepEqual(result.imports.map((entry) => entry.import.specifier), ["./default", "./nested", "./jsx"]);
});

test("never treats comments, strings, templates or member calls as import declarations", () => {
  const result = parsed(parseSource({ path: "fake.js", sourceText: `
    // import './fake'; require('./fake');
    /* export * from './fake'; */
    const text = "import('./fake')";
    const template = \`require('./fake')\`;
    object.import('./fake');
    const actual = \`value: \${import('./actual')}\`;
  ` }));
  assert.deepEqual(result.imports.map((entry) => entry.import.specifier), ["./actual"]);
  assert.deepEqual(result.unsupported, []);
});

test("computed imports retain locations without copying expressions or guessing destinations", () => {
  const sourceText = "import(privateName); import(`./constant`); import('./' + name);";
  const result = parsed(parseSource({ path: "computed.js", sourceText }));
  assert.deepEqual(result.imports, []);
  assert.equal(result.unsupported.length, 3);
  assert.ok(result.unsupported.every((entry) => entry.code === "computed_dynamic_import"));
  assert.equal(result.unsupported[0]!.location.start.offset, 0);
  assert.equal(JSON.stringify(result).includes("privateName"), false);
});

test("require and TypeScript import variants are explicitly unsupported, including shadowed require", () => {
  const result = parsed(parseSource({ path: "common.cts", sourceText: `
    require('./global');
    function local(require: (name: string) => unknown) { return require('./shadowed'); }
    import tool = require('./tool');
    type Remote = import('./type').Remote;
  ` }));
  assert.deepEqual(result.imports, []);
  assert.deepEqual(result.unsupported.map((entry) => entry.code), [
    "require_not_analyzed", "require_not_analyzed", "import_equals_not_analyzed", "import_type_not_analyzed",
  ]);
});

test("re-export chains preserve each syntactic hop without resolving star names", async () => {
  const index = parsed(parseSource({ path: "index.ts", sourceText: await fixture("reexports/index.ts") }));
  const middle = parsed(parseSource({ path: "middle.ts", sourceText: await fixture("reexports/middle.ts") }));
  const leaf = parsed(parseSource({ path: "leaf.ts", sourceText: await fixture("reexports/leaf.ts") }));
  assert.deepEqual(index.imports.map((entry) => entry.import.specifier), ["./middle", "./middle"]);
  assert.deepEqual(index.exportedNames, ["finalValue"]);
  assert.deepEqual(middle.imports.map((entry) => entry.import.specifier), ["./leaf"]);
  assert.deepEqual(middle.exportedNames, ["publicValue"]);
  assert.deepEqual(leaf.exportedNames, ["value"]);
});

test("export names include declarations and aliases, but exclude namespace internals", () => {
  const result = parsed(parseSource({ path: "exports.ts", sourceText: `
    export interface Shape {} export type Alias = Shape; export enum Kind { A }
    export namespace Group { export const hidden = 1; }
    const original = 1; export { original as exposed }; export default original;
  ` }));
  assert.deepEqual(result.exportedNames, ["Alias", "Group", "Kind", "Shape", "default", "exposed"]);
});

test("malformed input yields a bounded location diagnostic and does not poison the next file", async () => {
  const failure = parseSource({ path: "malformed.ts", sourceText: await fixture("malformed.ts") });
  assert.equal(failure.status, "failed");
  if (failure.status !== "failed") return;
  assert.equal(failure.diagnostic.code, "syntax_error");
  assert.equal(failure.diagnostic.location?.start.line, 1);
  assert.ok(failure.diagnostic.location!.start.column > 0);
  assert.ok(failure.diagnostic.message.length < 200);
  const sensitive = parseSource({ path: "private-project.ts", sourceText: "import { PRIVATE_SOURCE_MARKER as } from './private';" });
  assert.equal(sensitive.status, "failed");
  assert.equal(JSON.stringify(sensitive).includes("PRIVATE_SOURCE_MARKER"), false);
  assert.equal(JSON.stringify(sensitive).includes("private-project"), false);
  assert.equal(parseSource({ path: "next.ts", sourceText: "export const fine = 1;" }).status, "parsed");
});

test("uses supplied text only, without repository reads, execution or full type checking", () => {
  const read = vi.spyOn(fs, "readFileSync");
  const exists = vi.spyOn(fs, "existsSync");
  try {
    const result = parsed(parseSource({ path: "not/on/disk/file.ts", sourceText: `
      import Missing from './does-not-exist';
      const value: number = 'not a number';
      throw new Error('must never execute');
    ` }));
    assert.equal(result.imports[0]!.import.specifier, "./does-not-exist");
    assert.equal(read.mock.calls.length, 0);
    assert.equal(exists.mock.calls.length, 0);
  } finally { read.mockRestore(); exists.mockRestore(); }
});

test("validates paths, extensions, UTF-8 byte limits and file syntax modes", () => {
  for (const path of ["../escape.ts", "/absolute.ts", "C:/local.ts", "src\\file.ts"]) {
    const result = parseSource({ path, sourceText: "" });
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.diagnostic.code, "invalid_input");
  }
  for (const path of ["config.json", "file.ts.fixture"]) assert.equal(parseSource({ path, sourceText: "" }).status, "failed");
  const big = parseSource({ path: "large.ts", sourceText: "é".repeat(524289) });
  assert.equal(big.status, "failed");
  if (big.status === "failed") assert.equal(big.diagnostic.code, "source_too_large");
  for (const path of ["file.js", "file.jsx"]) assert.equal(parseSource({ path, sourceText: "const value: number = 1;" }).status, "failed");
  assert.equal(parseSource({ path: "file.js", sourceText: "const view = <div />;" }).status, "failed");
  for (const path of ["file.mts", "file.cts", "file.mjs", "file.cjs"]) assert.equal(parseSource({ path, sourceText: "export const value = 1;" }).status, "parsed");
});

test("keeps deterministic UTF-16 ranges and schema-safe specifiers", () => {
  const sourceText = "// emoji 😀\r\nimport './first';\r\nimport './first';\r\nimport '';";
  const input = { path: "positions.ts", sourceText };
  const result = parsed(parseSource(input));
  assert.deepEqual(parseSource(input), result);
  assert.equal(result.imports[0]!.location.start.offset, sourceText.indexOf("import"));
  assert.deepEqual(result.imports.map((entry) => entry.import.sourceLine), [2, 3]);
  assert.deepEqual(result.unsupported.map((entry) => entry.code), ["invalid_specifier"]);
});

test("structural evidence overflow fails explicitly instead of silently truncating", () => {
  const result = parseSource({ path: "bounded.js", sourceText: "import(target);\n".repeat(101) });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.diagnostic.code, "structure_limit");
});

test("import count overflow and excessive literal length remain bounded", () => {
  const excessive = parseSource({ path: "many.js", sourceText: "import './x';\n".repeat(10001) });
  assert.equal(excessive.status, "failed");
  if (excessive.status === "failed") assert.equal(excessive.diagnostic.code, "structure_limit");
  const long = parsed(parseSource({ path: "long.js", sourceText: `import '${"x".repeat(4097)}';` }));
  assert.deepEqual(long.imports, []);
  assert.equal(long.unsupported[0]!.code, "invalid_specifier");
});

test("parses the controlled demo snapshot as data with its declared malformed source", async () => {
  const { baseline, manifest } = await loadDemoStore();
  const failed: string[] = [];
  for (const file of baseline.files) {
    const result = parseSource(file);
    if (result.status === "failed") failed.push(file.path);
    else for (const entry of result.imports) assert.equal(extractedImportSchema.safeParse(entry.import).success, true);
  }
  assert.deepEqual(failed, [manifest.features.malformed]);
});
