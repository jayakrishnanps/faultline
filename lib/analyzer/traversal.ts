import type { DependencyGraph, ReachedFile, ReachReport } from "../../types/graph.ts";

/**
 * Traverse dependency -> importer using multi-source breadth-first search.
 * Sorted roots and neighbors make equal-length path selection reproducible.
 * Inputs must already use canonical repository-relative paths.
 */
export function traceDependents(
  graph: DependencyGraph,
  changedFiles: readonly string[],
  maxDepth = 4,
): ReachReport {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError("maxDepth must be a non-negative safe integer.");
  }

  const files = new Set(graph.files);
  if (files.size !== graph.files.length || files.has("")) {
    throw new Error("Graph files must have unique, non-empty paths.");
  }

  const reverse = new Map<string, Set<string>>();
  for (const { importer, dependency } of graph.edges) {
    if (!files.has(importer) || !files.has(dependency)) {
      throw new Error(`Dependency edge references an unknown file: ${importer} -> ${dependency}`);
    }
    const dependents = reverse.get(dependency) ?? new Set<string>();
    dependents.add(importer);
    reverse.set(dependency, dependents);
  }

  const roots = [...new Set(changedFiles)].sort();
  const nodes: ReachedFile[] = [];
  const visited = new Set<string>();
  for (const file of roots) {
    if (files.has(file)) {
      nodes.push({ file, distance: 0, path: [file] });
      visited.add(file);
    }
  }

  // An indexed queue avoids repeated Array.shift() copies on broad graphs.
  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]!;
    if (current.distance === maxDepth) continue;

    for (const file of [...(reverse.get(current.file) ?? [])].sort()) {
      if (visited.has(file)) continue;
      visited.add(file);
      nodes.push({ file, distance: current.distance + 1, path: [...current.path, file] });
    }
  }

  // Check after traversal: another root may already have reached a boundary neighbor.
  const truncated = nodes.some(
    (node) => node.distance === maxDepth &&
      [...(reverse.get(node.file) ?? [])].some((file) => !visited.has(file)),
  );

  return {
    nodes,
    unknownChangedFiles: roots.filter((file) => !files.has(file)),
    truncated,
    maxDepth,
  };
}
