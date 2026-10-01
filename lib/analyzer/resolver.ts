import { posix } from "node:path";
import { repositoryPathSchema } from "../../types/domain/primitives.ts";
import type { UnresolvedImport } from "../../types/domain/source.ts";
import type { ParsedImport } from "../../types/parser.ts";
import type { FileIndexResult, ImportResolutionResult, LocatedImportResolution, RepositoryFileIndex } from "../../types/resolver.ts";
import { MAX_TREE_ENTRIES, SOURCE_EXTENSIONS, sourceSyntax } from "./source-policy.ts";

export function createFileIndex(paths: readonly string[]): FileIndexResult {
  if (paths.length > MAX_TREE_ENTRIES) return { status: "invalid", code: "too_many_paths" };
  const files = new Set<string>();
  for (const path of paths) {
    if (!repositoryPathSchema.safeParse(path).success) return { status: "invalid", code: "invalid_path" };
    if (files.has(path)) return { status: "invalid", code: "duplicate_path" };
    files.add(path);
  }
  return { status: "ready", index: Object.freeze({ has: (path: string) => files.has(path) }) };
}

const substitutions: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"],
};

/** Initial repository-only policy, not TypeScript/bundler/package resolution. */
export function resolveImport(importer: string, entry: ParsedImport, files: RepositoryFileIndex): ImportResolutionResult {
  const unresolved = (reason: UnresolvedImport["reason"], detail: LocatedImportResolution["detail"] = null, candidates: readonly string[] = []): LocatedImportResolution => ({
    resolution: { status: "unresolved", importer, import: { ...entry.import, reason } },
    location: entry.location, detail, candidates,
  });
  const resolved = (dependency: string): LocatedImportResolution => ({
    resolution: { status: "resolved", relationship: { ...entry.import, importer, dependency } },
    location: entry.location, detail: null, candidates: [],
  });
  if (!repositoryPathSchema.safeParse(importer).success || !files.has(importer)) return { status: "invalid_input", code: "invalid_importer" };
  const specifier = entry.import.specifier;
  if (specifier.startsWith("@/") || specifier.startsWith("~") || specifier.startsWith("#") || specifier.startsWith("/")) {
    return unresolved("unsupported", "unsupported_alias");
  }
  if (/^node:[a-zA-Z0-9_/-]+$/.test(specifier)) return unresolved("external");
  if (!specifier || /[\\\u0000-\u001f\u007f:?!#]/.test(specifier)) return unresolved("unsupported", "unsupported_specifier");
  const relative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
  if (!relative) {
    // Bare package-shaped names (including scoped subpaths) are external by policy.
    // A bare tsconfig alias is indistinguishable without configuration; never guess.
    return /^(?:@[\w.-]+\/[\w.-]+|[\w-][\w.-]*)(?:\/[\w.-]+)*$/.test(specifier)
      ? unresolved("external") : unresolved("unsupported", "unsupported_specifier");
  }

  const segments = importer.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (!segments.length) return unresolved("outside_repository");
      segments.pop();
    } else segments.push(segment);
  }
  const target = segments.join("/");
  const directoryOnly = specifier.endsWith("/") || [".", ".."].includes(specifier.split("/").at(-1)!);
  const extension = posix.extname(target);
  let candidates: string[];
  if (!directoryOnly && extension) {
    if (!sourceSyntax(target)) return unresolved("unsupported", "unsupported_extension");
    if (files.has(target)) return resolved(target);
    candidates = (substitutions[extension] ?? []).map((suffix) => target.slice(0, -extension.length) + suffix);
  } else {
    const prefix = target ? `${target}/` : "";
    candidates = [
      ...(directoryOnly ? [] : SOURCE_EXTENSIONS.map((suffix) => target + suffix)),
      ...SOURCE_EXTENSIONS.map((suffix) => `${prefix}index${suffix}`),
    ];
  }
  const matches = candidates.filter((candidate) => files.has(candidate)).sort();
  if (matches.length === 1) return resolved(matches[0]!);
  return matches.length ? unresolved("ambiguous", null, matches) : unresolved("not_found");
}
