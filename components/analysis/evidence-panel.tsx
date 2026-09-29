import { featuredEvidence, graphSideLabel } from "../../lib/data/report-presentation.ts";
import type { ReportPresentation } from "../../types/report-presentation.ts";
import { EmptyState } from "../ui/empty-state";

export function EvidencePanel({ report }: { report: ReportPresentation }) {
  const path = featuredEvidence(report.paths);
  return (
    <aside className="panel evidence-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Featured evidence</h2>
      <p className="caption">One supplied path for review, not a risk ranking or a graph selection.</p>
      {path ? <>
        <p className="badge">{graphSideLabel(path.graphSide)} · {path.paths.length - 1} dependency hops</p>
        <ol className="evidence-chain">{path.paths.map((file, index) => <li key={`${index}:${file}`}><code>{file}</code></li>)}</ol>
        <a className="text-link" href="#impact-paths">Inspect all impact paths <span aria-hidden="true">↓</span></a>
      </> : <EmptyState title="No path evidence supplied"><p>A path will appear once changed roots and dependent relationships are available.</p></EmptyState>}
    </aside>
  );
}
