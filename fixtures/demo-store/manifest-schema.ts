import { z } from "zod";
import { graphSideSchema, languageSchema, repositoryIdSchema, repositoryPathSchema } from "../../types/domain/primitives.ts";
import { changedFileSchema } from "../../types/domain/report.ts";
import { sourceLimitsSchema } from "../../types/domain/source.ts";

export const scenarioIdSchema = z.enum(["localized", "shared-authentication", "localized-follow-up"]);
export const revisionIdSchema = z.enum(["baseline", ...scenarioIdSchema.options]);
export type RevisionId = z.infer<typeof revisionIdSchema>;

export const demoManifestSchema = z.strictObject({
  version: z.literal(1),
  repositoryId: repositoryIdSchema,
  indexVersion: z.string().min(1),
  limits: sourceLimitsSchema,
  files: z.array(z.strictObject({
    path: repositoryPathSchema,
    language: languageSchema,
    role: z.enum(["route", "layout", "middleware", "component", "module", "diagnostic", "test"]),
    purpose: z.string().min(1),
  })).min(40).max(80),
  scenarios: z.array(z.strictObject({
    id: scenarioIdSchema,
    base: z.literal("baseline"),
    previousScenario: scenarioIdSchema.nullable(),
    description: z.string().min(1),
    // Each overlay is a complete replacement against baseline, never a commit delta.
    overlays: z.array(repositoryPathSchema).min(1),
    changes: z.array(changedFileSchema).min(1),
  })).length(3),
  expectedPaths: z.array(z.strictObject({
    revision: revisionIdSchema,
    graphSide: graphSideSchema,
    paths: z.array(repositoryPathSchema).min(2).max(13),
  })).min(1),
  features: z.strictObject({
    cycle: z.array(repositoryPathSchema).min(3),
    isolated: repositoryPathSchema,
    missingImport: z.strictObject({ importer: repositoryPathSchema, specifier: z.string().min(1) }),
    malformed: repositoryPathSchema,
  }),
}).superRefine((manifest, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const files = new Set(manifest.files.map((file) => file.path));
  if (files.size !== manifest.files.length) issue("Duplicate canonical fixture path");
  if (new Set(manifest.scenarios.map((scenario) => scenario.id)).size !== 3) issue("Each scenario must appear exactly once");
  for (const scenario of manifest.scenarios) {
    if (scenario.previousScenario === scenario.id) issue("A scenario cannot precede itself");
    if (new Set(scenario.overlays).size !== scenario.overlays.length) issue("Duplicate overlay path");
    for (const path of scenario.overlays) if (!files.has(path)) issue("Overlay path must exist in baseline");
    const changes = scenario.changes.map((change) => change.path);
    if (new Set(changes).size !== changes.length || changes.length !== scenario.overlays.length
      || changes.some((path) => !scenario.overlays.includes(path))) issue("Expected PR changes must match replacement overlay paths");
    if (scenario.changes.some((change) => change.changeType !== "modified" || change.previousPath !== null)) issue("This fixture collection supports replacement overlays only");
  }
  const referenced = [
    ...manifest.expectedPaths.flatMap((path) => path.paths), ...manifest.features.cycle,
    manifest.features.isolated, manifest.features.missingImport.importer, manifest.features.malformed,
  ];
  if (referenced.some((path) => !files.has(path))) issue("Expected evidence references an unknown fixture file");
  if (manifest.features.cycle[0] !== manifest.features.cycle.at(-1)) issue("Cycle must close at its starting module");
});
export type DemoManifest = z.infer<typeof demoManifestSchema>;
