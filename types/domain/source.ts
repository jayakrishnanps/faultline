import { z } from "zod";
import { countSchema, edgeTypeSchema, fileTypeSchema, languageSchema, parseStatusSchema, repositoryIdSchema, repositoryPathSchema, shaSchema, sourceFileIdSchema, sourceLineSchema } from "./primitives.ts";

export const extractedImportSchema = z.strictObject({
  specifier: z.string().min(1).max(4096),
  edgeType: edgeTypeSchema,
  sourceLine: sourceLineSchema,
  isTypeOnly: z.boolean(),
});
export const unresolvedImportSchema = z.strictObject({
  ...extractedImportSchema.shape,
  reason: z.enum(["external", "not_found", "unsupported", "ambiguous", "outside_repository"]),
});
export const resolvedRelationshipSchema = z.strictObject({
  ...extractedImportSchema.shape,
  importer: repositoryPathSchema,
  dependency: repositoryPathSchema,
});
export const importResolutionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("resolved"), relationship: resolvedRelationshipSchema }),
  z.strictObject({ status: z.literal("unresolved"), importer: repositoryPathSchema, import: unresolvedImportSchema }),
]);

export const sourceLimitsSchema = z.strictObject({
  maxSourceFiles: z.number().int().min(1).max(1000),
  maxFileBytes: z.number().int().min(1024).max(1048576),
  maxTotalSourceBytes: z.number().int().min(1024).max(52428800),
});
export const sourceInputSchema = z.strictObject({
  path: repositoryPathSchema,
  contentSha: shaSchema,
  language: languageSchema,
  // Transient input only. Never part of a persisted/report schema.
  sourceText: z.string().max(1048576),
});
export const repositorySourceInputSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitSha: shaSchema,
  indexVersion: z.string().min(1).max(200),
  limits: sourceLimitsSchema,
  files: z.array(sourceInputSchema).max(1000),
}).superRefine((input, ctx) => {
  const paths = new Set<string>();
  let total = 0;
  if (input.files.length > input.limits.maxSourceFiles) ctx.addIssue({ code: "custom", message: "Source file limit exceeded", path: ["files"] });
  input.files.forEach((file, index) => {
    if (paths.has(file.path)) ctx.addIssue({ code: "custom", message: "Duplicate source path", path: ["files", index, "path"] });
    paths.add(file.path);
    const bytes = new TextEncoder().encode(file.sourceText).length;
    total += bytes;
    if (bytes > input.limits.maxFileBytes) ctx.addIssue({ code: "custom", message: "UTF-8 file byte limit exceeded", path: ["files", index, "sourceText"] });
  });
  if (total > input.limits.maxTotalSourceBytes) ctx.addIssue({ code: "custom", message: "Total UTF-8 source byte limit exceeded", path: ["files"] });
});

export const sourceFileSchema = z.strictObject({
  id: sourceFileIdSchema,
  path: repositoryPathSchema,
  contentSha: shaSchema,
  language: languageSchema,
  fileType: fileTypeSchema,
  sizeBytes: countSchema,
  isEntryPoint: z.boolean(),
  isTest: z.boolean(),
  routePath: z.string().max(4096).nullable(),
  parseStatus: parseStatusSchema,
  parseError: z.string().max(2000).nullable(),
  imports: z.array(extractedImportSchema).max(10000),
  unresolvedImports: z.array(unresolvedImportSchema).max(10000),
  exportedNames: z.array(z.string().min(1).max(4096)).max(10000),
});

export type RepositorySourceInput = z.infer<typeof repositorySourceInputSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type ExtractedImport = z.infer<typeof extractedImportSchema>;
export type ResolvedRelationship = z.infer<typeof resolvedRelationshipSchema>;
export type ImportResolution = z.infer<typeof importResolutionSchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type UnresolvedImport = z.infer<typeof unresolvedImportSchema>;
export type SourceLimits = z.infer<typeof sourceLimitsSchema>;
