import type { SourceSyntax } from "../../types/parser.ts";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] as const;
/** Operational metadata bound, separate from SQL source-file limits. */
export const MAX_TREE_ENTRIES = 20000;
export const MAX_RELATIONSHIPS = 100000;

export function sourceSyntax(path: string): SourceSyntax | null {
  switch (path.slice(path.lastIndexOf(".")).toLowerCase()) {
    case ".ts": case ".mts": case ".cts": return "ts";
    case ".tsx": return "tsx";
    case ".js": case ".mjs": case ".cjs": return "js";
    case ".jsx": return "jsx";
    default: return null;
  }
}

const excludedDirectories = new Set([
  "node_modules", "vendor", ".git", ".next", "out", "dist", "build", "coverage",
  ".turbo", ".cache", ".vercel", ".netlify", ".output", "__generated__", "generated",
  ".ssh", ".aws", ".secrets", "secrets",
]);

/** Conservative path policy, not a detector for arbitrary secrets in source code. */
export function isExcludedSourcePath(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1)!;
  return parts.slice(0, -1).some((part) => excludedDirectories.has(part))
    || parts.some((part) => part === ".env" || part.startsWith(".env."))
    || /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/.test(name)
    || /\.(?:pem|key|p12|pfx)(?:\.|$)/.test(name)
    || /^(?:\.npmrc|\.yarnrc|\.netrc|id_rsa|id_ed25519|\.pnp)(?:\.|$)/.test(name)
    || /\.(?:min|generated)\.[^.]+$/.test(name);
}
