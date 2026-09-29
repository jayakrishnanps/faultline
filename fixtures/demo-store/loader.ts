/** Trusted Node fixture tooling. Target repository files are read as text only. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changedFileSchema } from "../../types/domain/report.ts";
import { repositorySourceInputSchema } from "../../types/domain/source.ts";
import type { RepositorySourceInput } from "../../types/domain/source.ts";
import { demoManifestSchema, revisionIdSchema } from "./manifest-schema.ts";
import type { DemoManifest, RevisionId } from "./manifest-schema.ts";

const fixtureRoot = fileURLToPath(new URL("./", import.meta.url));
const comparePaths = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

async function readLocalText(path: string): Promise<string> {
  const root = await realpath(fixtureRoot);
  const actual = await realpath(resolve(root, path));
  const within = relative(root, actual);
  if (isAbsolute(within) || within === ".." || within.startsWith("../") || within.startsWith("..\\")) {
    throw new Error("Fixture path resolves outside the local collection");
  }
  // CRLF checkout settings must not change fixture identities or scenario diffs.
  return (await readFile(actual, "utf8")).replaceAll("\r\n", "\n");
}

export async function loadDemoManifest(): Promise<DemoManifest> {
  const value: unknown = JSON.parse(await readLocalText("manifest.json"));
  return demoManifestSchema.parse(value);
}

/** Real Git blob hashing for content; snapshot identities below are synthetic. */
export function fixtureContentSha(sourceText: string): string {
  const source = Buffer.from(sourceText, "utf8");
  return createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex");
}

async function readSnapshot(manifest: DemoManifest, revision: RevisionId): Promise<RepositorySourceInput> {
  const scenario = manifest.scenarios.find((entry) => entry.id === revision);
  if (revision !== "baseline" && !scenario) throw new Error("Unknown demo-store scenario");
  const overlays = new Set(scenario?.overlays ?? []);
  const files = await Promise.all([...manifest.files].sort((a, b) => comparePaths(a.path, b.path)).map(async (file) => {
    const directory = overlays.has(file.path) ? `overlays/${revision}` : "baseline";
    const sourceText = await readLocalText(`sources/${directory}/${file.path}.fixture`);
    return { path: file.path, language: file.language, sourceText, contentSha: fixtureContentSha(sourceText) };
  }));
  // A deterministic local snapshot identifier, NOT a commit in a real Git repository.
  const commitSha = createHash("sha256").update("faultline-demo-store-snapshot-v1\n")
    .update(JSON.stringify(files.map(({ path, contentSha }) => [path, contentSha]))).digest("hex");
  return repositorySourceInputSchema.parse({
    repositoryId: manifest.repositoryId, commitSha, indexVersion: manifest.indexVersion,
    limits: manifest.limits, files,
  });
}

/** Counts the single replacement span used by these controlled overlays; not a Git diff engine. */
function replacementCounts(before: string, after: string) {
  const lines = (text: string) => text.replace(/\n$/, "").split("\n");
  const oldLines = lines(before);
  const newLines = lines(after);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
  return { additions: newEnd - start, deletions: oldEnd - start };
}

export function compareFixtureSnapshots(base: RepositorySourceInput, head: RepositorySourceInput) {
  if (base.repositoryId !== head.repositoryId) throw new Error("Cannot compare different fixture repositories");
  const originals = new Map(base.files.map((file) => [file.path, file]));
  if (head.files.length !== originals.size || head.files.some((file) => !originals.has(file.path))) {
    throw new Error("Demo-store comparisons support replacement overlays only");
  }
  return [...head.files].sort((a, b) => comparePaths(a.path, b.path)).flatMap((file) => {
    const original = originals.get(file.path)!;
    if (original.sourceText === file.sourceText) return [];
    return [changedFileSchema.parse({
      path: file.path, previousPath: null, changeType: "modified",
      ...replacementCounts(original.sourceText, file.sourceText), isSupported: true, skipReason: null,
    })];
  });
}

export async function loadDemoStore(revisionInput: string = "baseline") {
  const revision = revisionIdSchema.parse(revisionInput);
  const manifest = await loadDemoManifest();
  const baseline = await readSnapshot(manifest, "baseline");
  const head = revision === "baseline" ? baseline : await readSnapshot(manifest, revision);
  // Always compute from baseline, including follow-ups. previousScenario is history only.
  const changes = compareFixtureSnapshots(baseline, head);
  const scenario = manifest.scenarios.find((entry) => entry.id === revision);
  const expected = [...(scenario?.changes ?? [])].sort((a, b) => comparePaths(a.path, b.path));
  if (JSON.stringify(changes) !== JSON.stringify(expected)) {
    throw new Error("Full baseline-relative fixture diff does not match manifest changes");
  }
  return { revision, manifest, baseline, head, changes };
}
