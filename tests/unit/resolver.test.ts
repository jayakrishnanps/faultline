import assert from "node:assert/strict";
import { test } from "vitest";
import { createFileIndex, resolveImport } from "../../lib/analyzer/resolver.ts";
import { parseSource } from "../../lib/analyzer/parser.ts";
import { importResolutionSchema } from "../../types/domain/source.ts";
import type { ParsedImport } from "../../types/parser.ts";

function resolve(specifier: string, paths: string[], importer = "src/nested/main.ts") {
  const index = createFileIndex([importer, ...paths]);
  assert.equal(index.status, "ready");
  if (index.status !== "ready") throw new Error("Invalid test index");
  const entry: ParsedImport = {
    import: { specifier, sourceLine: 7, isTypeOnly: true, edgeType: "static_import" },
    location: { start: { line: 7, column: 2, offset: 90 }, end: { line: 7, column: 31, offset: 119 } },
  };
  const result = resolveImport(importer, entry, index.index);
  assert.ok("resolution" in result);
  assert.equal(importResolutionSchema.safeParse(result.resolution).success, true);
  assert.deepEqual(result.location, entry.location);
  const metadata = result.resolution.status === "resolved" ? result.resolution.relationship : result.resolution.import;
  assert.equal(metadata.specifier, specifier);
  assert.equal(metadata.sourceLine, 7);
  assert.equal(metadata.isTypeOnly, true);
  return result;
}

test("normalizes nested relative paths with case-sensitive POSIX semantics", () => {
  const result = resolve("../other/./folder/../Target.ts", ["src/other/Target.ts"]);
  assert.equal(result.resolution.status, "resolved");
  if (result.resolution.status === "resolved") assert.equal(result.resolution.relationship.dependency, "src/other/Target.ts");
  assert.equal(resolve("../other/target.ts", ["src/other/Target.ts"]).resolution.status, "unresolved");
  assert.equal(resolve("./with space.ts", ["src/nested/with space.ts"]).resolution.status, "resolved");
  assert.equal(resolve("..\\other\\Target.ts", ["src/other/Target.ts"]).detail, "unsupported_specifier");
});

test.each([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])("resolves explicit and extensionless %s filenames", (extension) => {
  assert.equal(resolve(`./value${extension}`, [`src/nested/value${extension}`]).resolution.status, "resolved");
  assert.equal(resolve("./value", [`src/nested/value${extension}`]).resolution.status, "resolved");
});

test("resolves directory indexes including dot and parent without package metadata", () => {
  for (const specifier of ["./folder", "./folder/"]) assert.equal(resolve(specifier, ["src/nested/folder/index.tsx"]).resolution.status, "resolved");
  assert.equal(resolve(".", ["src/nested/index.ts"]).resolution.status, "resolved");
  assert.equal(resolve("..", ["src/index.ts"]).resolution.status, "resolved");
  assert.equal(resolve("./folder/", ["src/nested/folder.ts"]).resolution.status, "unresolved");
  assert.equal(resolve("../..", ["index.js"]).resolution.status, "resolved");
});

test("substitutes JavaScript extensions only when an exact target is absent", () => {
  for (const [request, target] of [["value.js", "value.ts"], ["value.js", "value.tsx"], ["value.jsx", "value.tsx"], ["value.mjs", "value.mts"], ["value.cjs", "value.cts"]]) {
    assert.equal(resolve(`./${request}`, [`src/nested/${target}`]).resolution.status, "resolved");
  }
  const exact = resolve("./value.js", ["src/nested/value.js", "src/nested/value.ts"]);
  assert.equal(exact.resolution.status, "resolved");
  if (exact.resolution.status === "resolved") assert.equal(exact.resolution.relationship.dependency, "src/nested/value.js");
  assert.equal(resolve("./value.ts", ["src/nested/value.js"]).resolution.status, "unresolved");
  assert.equal(resolve("./value.js", ["src/nested/value.d.ts"]).resolution.status, "unresolved");
});

test("reports genuine ambiguity across file, substitution and index candidates", () => {
  for (const [specifier, paths] of [
    ["./value", ["src/nested/value.ts", "src/nested/value.js"]],
    ["./value", ["src/nested/value.ts", "src/nested/value/index.ts"]],
    ["./value/", ["src/nested/value/index.ts", "src/nested/value/index.js"]],
    ["./value.js", ["src/nested/value.ts", "src/nested/value.tsx"]],
  ] as const) {
    const result = resolve(specifier, [...paths]);
    assert.equal(result.resolution.status, "unresolved");
    if (result.resolution.status === "unresolved") assert.equal(result.resolution.import.reason, "ambiguous");
    assert.deepEqual(result.candidates, [...paths].sort());
    assert.deepEqual(resolve(specifier, [...paths].reverse()), result);
  }
});

test("distinguishes packages, missing local targets, aliases and unsupported syntax", () => {
  for (const name of ["react", "next/link", "@scope/pkg/subpath", "node:fs/promises", "src/local-looking"]) {
    const result = resolve(name, []);
    assert.equal(result.resolution.status, "unresolved");
    if (result.resolution.status === "unresolved") assert.equal(result.resolution.import.reason, "external");
  }
  for (const name of ["@/auth", "~/auth", "#auth", "/src/auth"]) assert.equal(resolve(name, []).detail, "unsupported_alias");
  for (const name of ["https://example.test/file.js", "./file.ts?raw", "loader!./file.ts", "./bad\0.ts"]) assert.equal(resolve(name, []).detail, "unsupported_specifier");
  assert.equal(resolve("./style.css", ["src/nested/style.css"]).detail, "unsupported_extension");
  const missing = resolve("./missing", []);
  assert.equal(missing.resolution.status, "unresolved");
  if (missing.resolution.status === "unresolved") assert.equal(missing.resolution.import.reason, "not_found");
});

test("rejects any normalization step above the root, even when it later returns inside", () => {
  for (const specifier of ["../../../secret.ts", "../../../src/nested/value.ts"]) {
    const result = resolve(specifier, ["src/nested/value.ts"]);
    assert.equal(result.resolution.status, "unresolved");
    if (result.resolution.status === "unresolved") assert.equal(result.resolution.import.reason, "outside_repository");
  }
  assert.equal(resolve("../../root.ts", ["root.ts"]).resolution.status, "resolved");
});

test("validates canonical index paths and retains parser provenance end to end", () => {
  for (const paths of [["../a.ts"], ["C:/a.ts"], ["a\\b.ts"], ["a.ts", "a.ts"]]) assert.equal(createFileIndex(paths).status, "invalid");
  assert.equal(createFileIndex(["A.ts", "a.ts"]).status, "ready");
  const parsed = parseSource({ path: "main.ts", sourceText: "\nimport type { A } from './a.js';" });
  const index = createFileIndex(["main.ts", "a.ts"]);
  assert.equal(parsed.status, "parsed");
  if (parsed.status !== "parsed" || index.status !== "ready") return;
  const result = resolveImport("main.ts", parsed.imports[0]!, index.index);
  assert.ok("resolution" in result);
  assert.deepEqual(result.location, parsed.imports[0]!.location);
  assert.deepEqual(result.resolution, { status: "resolved", relationship: { importer: "main.ts", dependency: "a.ts", specifier: "./a.js", edgeType: "static_import", sourceLine: 2, isTypeOnly: true } });
  for (const path of ["../invalid.ts", "not-in-index.ts"]) {
    assert.deepEqual(resolveImport(path, parsed.imports[0]!, index.index), { status: "invalid_input", code: "invalid_importer" });
  }
});
