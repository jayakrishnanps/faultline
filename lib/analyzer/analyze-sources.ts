import { repositoryPathSchema } from "../../types/domain/primitives.ts";
import type { SourceAnalysisInput, SourceAnalysisResult, SourceAnalysisCounts } from "../../types/discovery.ts";
import type { LocatedImportResolution } from "../../types/resolver.ts";
import { discoverSources } from "./discovery.ts";
import { parseSource } from "./parser.ts";
import { createFileIndex, resolveImport } from "./resolver.ts";
import { MAX_RELATIONSHIPS, MAX_TREE_ENTRIES } from "./source-policy.ts";

/** Preflight the entire supplied batch before parsing any file. No source in results. */
export function analyzeSources(input: SourceAnalysisInput): SourceAnalysisResult {
  const discovery = discoverSources(input);
  if (discovery.status !== "ready") return discovery;
  if (!Array.isArray(input.sources)) return { status: "invalid_input", code: "invalid_sources" };
  if (input.sources.length > MAX_TREE_ENTRIES) return { status: "limit_exceeded", limit: "sourceEntries", maximum: MAX_TREE_ENTRIES };
  const knownPaths = new Set(input.tree.entries.map((entry) => entry.path));
  const wanted = new Map(discovery.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const sources = new Map<string, string>();
  const skipped = [...discovery.skipped];
  // Reserve known sizes even for missing source; unknown sizes are measured below.
  let totalBytes = discovery.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  for (const source of input.sources) {
    if (!source || typeof source !== "object") return { status: "invalid_input", code: "invalid_sources" };
    if (!repositoryPathSchema.safeParse(source.path).success || !knownPaths.has(source.path) || seen.has(source.path)) return { status: "invalid_input", code: "invalid_sources" };
    seen.add(source.path);
    const metadata = wanted.get(source.path);
    // Do not access sourceText for excluded paths or metadata-declared binaries.
    if (!metadata) continue;
    const text = source.sourceText;
    if (typeof text !== "string") return { status: "invalid_input", code: "invalid_sources" };
    if (text.length > discovery.limits.maxFileBytes) return { status: "limit_exceeded", limit: "maxFileBytes", maximum: discovery.limits.maxFileBytes, path: source.path };
    const size = new TextEncoder().encode(text).length;
    if (size > discovery.limits.maxFileBytes) return { status: "limit_exceeded", limit: "maxFileBytes", maximum: discovery.limits.maxFileBytes, path: source.path };
    totalBytes += size - (metadata.sizeBytes ?? 0);
    if (totalBytes > discovery.limits.maxTotalSourceBytes) return { status: "limit_exceeded", limit: "maxTotalSourceBytes", maximum: discovery.limits.maxTotalSourceBytes };
    if (metadata.sizeBytes !== null && size !== metadata.sizeBytes) return { status: "invalid_input", code: "size_mismatch", path: source.path };
    if (text.includes("\0")) { skipped.push({ path: source.path, reason: "binary" }); continue; }
    sources.set(source.path, text);
  }
  for (const file of discovery.files) if (!seen.has(file.path)) skipped.push({ path: file.path, reason: "source_missing" });
  skipped.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const binaryPaths = new Set(skipped.filter((file) => file.reason === "binary").map((file) => file.path));
  const index = createFileIndex(discovery.files.filter((file) => !binaryPaths.has(file.path)).map((file) => file.path));
  if (index.status !== "ready") return { status: "invalid_input", code: "invalid_tree" };
  const counts: { -readonly [K in keyof SourceAnalysisCounts]: SourceAnalysisCounts[K] } = {
    ...discovery.counts, parsedFiles: 0, failedFiles: 0, skippedFiles: skipped.length,
    resolvedImports: 0, unresolvedLocalImports: 0, externalImports: 0, unsupportedRelationships: 0, observedRelationships: 0,
  };
  const files: Extract<SourceAnalysisResult, { status: "analyzed" }>["files"][number][] = [];
  for (const metadata of discovery.files) {
    const text = sources.get(metadata.path);
    if (text === undefined) continue;
    const parse = parseSource({ path: metadata.path, sourceText: text });
    if (parse.status === "parsed" && counts.observedRelationships + parse.imports.length + parse.unsupported.length > MAX_RELATIONSHIPS) {
      return { status: "limit_exceeded", limit: "relationships", maximum: MAX_RELATIONSHIPS };
    }
    const resolutions: LocatedImportResolution[] = [];
    if (parse.status === "parsed") {
      for (const entry of parse.imports) {
        const result = resolveImport(metadata.path, entry, index.index);
        if ("status" in result) return { status: "invalid_input", code: "invalid_tree" };
        resolutions.push(result);
      }
    }
    files.push({ path: metadata.path, parse, resolutions });
    if (parse.status === "failed") { counts.failedFiles++; continue; }
    counts.parsedFiles++;
    counts.unsupportedRelationships += parse.unsupported.length;
    counts.observedRelationships += parse.imports.length + parse.unsupported.length;
    for (const { resolution } of resolutions) {
      if (resolution.status === "resolved") counts.resolvedImports++;
      else if (resolution.import.reason === "external") counts.externalImports++;
      else if (resolution.import.reason === "unsupported") counts.unsupportedRelationships++;
      else counts.unresolvedLocalImports++;
    }
  }
  return { status: "analyzed", counts, files, skipped };
}
