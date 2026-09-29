/** In-memory analyzer contracts. These are not database row types. */
export interface DependencyEdge {
  /** The file containing the import. */
  readonly importer: string;
  /** The file that the importer depends on. */
  readonly dependency: string;
}

export interface DependencyGraph {
  readonly files: readonly string[];
  readonly edges: readonly DependencyEdge[];
}

export interface ReachedFile {
  readonly file: string;
  readonly distance: number;
  /** One shortest reverse-dependency path, starting at a changed file. */
  readonly path: readonly string[];
}

export interface ReachReport {
  readonly nodes: readonly ReachedFile[];
  readonly unknownChangedFiles: readonly string[];
  /** True only if the depth limit excluded otherwise reachable nodes. */
  readonly truncated: boolean;
  readonly maxDepth: number;
}
