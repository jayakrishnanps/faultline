import { loadDemoStore } from "../../fixtures/demo-store/loader.ts";

try {
  if (process.argv.length > 3) throw new Error("Usage: npm run fixtures:load -- [baseline|localized|shared-authentication|localized-follow-up]");
  const fixture = await loadDemoStore(process.argv[2] ?? "baseline");
  console.log(JSON.stringify({
    fixture: "demo-store", revision: fixture.revision,
    identityKind: "synthetic-local-snapshot", baselineSha: fixture.baseline.commitSha,
    headSha: fixture.head.commitSha, files: fixture.head.files.length,
    routes: fixture.manifest.files.filter((file) => file.role === "route").length,
    inertTests: fixture.manifest.files.filter((file) => file.role === "test").length,
    fullPrChanges: fixture.changes,
    expectedPaths: fixture.manifest.expectedPaths.filter((path) => path.revision === fixture.revision),
    note: "Source read as text. No repository code or fixture tests executed; no impact score computed.",
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to load demo-store fixture");
  process.exitCode = 1;
}
