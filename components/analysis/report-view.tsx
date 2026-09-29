import type { ReportPresentation } from "../../types/report-presentation.ts";
import { DependencyMap } from "../graph/dependency-map";
import { ReportHeader } from "./report-header";
import { SummaryMetrics } from "./summary-metrics";
import { EvidencePanel } from "./evidence-panel";
import { ImpactPaths } from "./impact-paths";
import { TestAssociations } from "./test-associations";
import { OwnersPanel } from "./owners-panel";

/** All data enters here; the components do not know about the demo fixture or SDKs. */
export function ReportView({ report }: { report: ReportPresentation }) {
  return <article className="report-view">
    <ReportHeader report={report} />
    <SummaryMetrics report={report} />
    <nav className="section-navigation" aria-label="Report sections">
      <a href="#dependency-map">Graph</a><a href="#evidence-title">Evidence</a><a href="#impact-paths">Paths</a><a href="#test-associations">Tests</a><a href="#owners">Owners</a>
    </nav>
    <div className="report-grid"><DependencyMap report={report} /><EvidencePanel report={report} /></div>
    <ImpactPaths paths={report.paths} />
    <div className="supporting-grid"><TestAssociations tests={report.tests} /><OwnersPanel owners={report.owners} /></div>
    <aside className="limitations" aria-labelledby="limitations-title">
      <h2 id="limitations-title">What this report can tell you</h2>
      <ul>{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </aside>
  </article>;
}
