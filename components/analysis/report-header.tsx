import type { ReportPresentation } from "../../types/report-presentation.ts";
import { graphSideLabel } from "../../lib/data/report-presentation.ts";

export function ReportHeader({ report }: { report: ReportPresentation }) {
  return (
    <header className="page-heading">
      <div className="notice" role="note" aria-label="Report provenance">
        <p className="notice-title">{report.provenance.label}</p>
        <p>{report.provenance.explanation}</p>
      </div>
      <p className="eyebrow">{report.provenance.kind === "presentation_sample" ? "Illustrative pull request" : "Pull request report"}</p>
      <h1 className="report-title">{report.title}</h1>
      <dl className="revision-details">
        <div><dt>Repository</dt><dd>{report.repositoryLabel}</dd></div>
        <div><dt>Revision</dt><dd>{report.revisionLabel}</dd></div>
        <div><dt>Primary graph side</dt><dd>{graphSideLabel(report.graphSide)}</dd></div>
      </dl>
    </header>
  );
}
