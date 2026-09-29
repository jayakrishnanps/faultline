import type { DependencyGraph } from "../../types/graph.ts";

/** Hand-authored demo-store relationships, not a parsed or connected repository. */
export const demoGraph: DependencyGraph = {
  files: [
    "src/auth/token.ts",
    "src/auth/session.ts",
    "src/billing/client.ts",
    "app/dashboard/page.tsx",
    "app/api/billing/route.ts",
    "tests/session.test.ts",
    "src/catalog/products.ts",
  ],
  edges: [
    { importer: "src/auth/session.ts", dependency: "src/auth/token.ts" },
    { importer: "src/billing/client.ts", dependency: "src/auth/session.ts" },
    { importer: "app/dashboard/page.tsx", dependency: "src/auth/session.ts" },
    { importer: "app/api/billing/route.ts", dependency: "src/billing/client.ts" },
    { importer: "tests/session.test.ts", dependency: "src/auth/session.ts" },
  ],
};

export const demoChangedFiles = ["src/auth/token.ts"] as const;
