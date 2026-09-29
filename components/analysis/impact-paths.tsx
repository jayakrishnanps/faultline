import { graphSideLabel } from "../../lib/data/report-presentation.ts";
import type { ReportPresentation } from "../../types/report-presentation.ts";
import { EmptyState } from "../ui/empty-state";
import { Panel } from "../ui/panel";

export function ImpactPaths({ paths }: Pick<ReportPresentation, "paths">) {
  return <Panel id="impact-paths" title="Impact paths" description="Expand a path to follow the evidence from a changed file to a dependent.">
    {paths.length ? <div className="path-list">{paths.map((path, index) => <details key={`${path.graphSide}:${index}`}>
      <summary><code>{path.paths.at(-1)}</code><span className="path-label">{graphSideLabel(path.graphSide)} · {path.paths.length === 1 ? "Changed root" : `${path.paths.length - 1} hops`}</span></summary>
      <ol className="evidence-chain">{path.paths.map((file, step) => <li key={`${step}:${file}`}><code>{file}</code></li>)}</ol>
    </details>)}</div> : <EmptyState title="No impact paths supplied"><p>This does not establish that a change is isolated. Evidence is needed before drawing that conclusion.</p></EmptyState>}
  </Panel>;
}
