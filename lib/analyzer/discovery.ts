import { repositoryPathSchema } from "../../types/domain/primitives.ts";
import { analysisLimitsSchema, DEFAULT_ANALYSIS_LIMITS, treeEntrySchema } from "../../types/discovery.ts";
import type { DiscoveryInput, DiscoveryResult, RepositoryTreeEntry, SkippedSource } from "../../types/discovery.ts";
import { isExcludedSourcePath, MAX_TREE_ENTRIES, sourceSyntax } from "./source-policy.ts";

/** Metadata-only preflight. Returned files are the only paths whose text is needed. */
export function discoverSources(input: DiscoveryInput): DiscoveryResult {
  if (!input || !input.tree || !Array.isArray(input.tree.entries) || typeof input.tree.truncated !== "boolean" || !Array.isArray(input.changedPaths)) {
    return { status: "invalid_input", code: "invalid_tree" };
  }
  const parsedLimits = analysisLimitsSchema.safeParse(input.limits === undefined ? DEFAULT_ANALYSIS_LIMITS : input.limits);
  if (!parsedLimits.success) return { status: "invalid_input", code: "invalid_limits" };
  const limits = parsedLimits.data;
  if (input.tree.truncated) return { status: "invalid_input", code: "truncated_tree" };
  if (input.tree.entries.length > MAX_TREE_ENTRIES) return { status: "limit_exceeded", limit: "treeEntries", maximum: MAX_TREE_ENTRIES };
  if (input.changedPaths.length > limits.maxChangedFiles) return { status: "limit_exceeded", limit: "maxChangedFiles", maximum: limits.maxChangedFiles };
  const changed = new Set<string>();
  for (const path of input.changedPaths) {
    if (!repositoryPathSchema.safeParse(path).success || changed.has(path)) return { status: "invalid_input", code: "invalid_changed_paths" };
    changed.add(path);
  }
  const entries = new Map<string, RepositoryTreeEntry>();
  for (const raw of input.tree.entries) {
    const entry = treeEntrySchema.safeParse(raw);
    if (!entry.success) return { status: "invalid_input", code: "invalid_tree" };
    if (entries.has(entry.data.path)) return { status: "invalid_input", code: "duplicate_path" };
    entries.set(entry.data.path, entry.data);
  }
  // A supplied descendant under a file/symlink/submodule contradicts this tree.
  for (const file of entries.values()) {
    const parts = file.path.split("/");
    for (let length = 1; length < parts.length; length++) {
      const ancestor = entries.get(parts.slice(0, length).join("/"));
      if (ancestor && ancestor.kind !== "directory") return { status: "invalid_input", code: "invalid_tree" };
    }
  }
  const files: RepositoryTreeEntry[] = [];
  const skipped: SkippedSource[] = [];
  let excludedEntries = 0;
  let discoveredRelevantFiles = 0;
  let knownBytes = 0;
  for (const file of entries.values()) {
    if (file.kind !== "file" || isExcludedSourcePath(file.path) || !sourceSyntax(file.path)) { excludedEntries++; continue; }
    discoveredRelevantFiles++;
    if (discoveredRelevantFiles > limits.maxSourceFiles) return { status: "limit_exceeded", limit: "maxSourceFiles", maximum: limits.maxSourceFiles };
    if (file.isBinary) { skipped.push({ path: file.path, reason: "binary" }); continue; }
    if (file.sizeBytes !== null) {
      if (file.sizeBytes > limits.maxFileBytes) return { status: "limit_exceeded", limit: "maxFileBytes", maximum: limits.maxFileBytes, path: file.path };
      knownBytes += file.sizeBytes;
      if (knownBytes > limits.maxTotalSourceBytes) return { status: "limit_exceeded", limit: "maxTotalSourceBytes", maximum: limits.maxTotalSourceBytes };
    }
    files.push(file);
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  skipped.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { status: "ready", limits, files, skipped, counts: { treeEntries: input.tree.entries.length, excludedEntries, discoveredRelevantFiles } };
}
