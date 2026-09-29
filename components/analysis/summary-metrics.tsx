import { summarizePresentation } from "../../lib/data/report-presentation.ts";
import type { ReportPresentation } from "../../types/report-presentation.ts";

export function SummaryMetrics({ report }: { report: ReportPresentation }) {
  const counts = summarizePresentation(report);
  const metrics = [
    ["Changed files", counts.changed], ["Direct dependents", counts.direct],
    ["Indirect dependents", counts.indirect], ["Associated test files", counts.tests],
  ] as const;
  return (
    <section aria-labelledby="summary-title">
      <h2 id="summary-title" className="section-label">{report.provenance.kind === "presentation_sample" ? "Sample summary" : "Report summary"}</h2>
      <dl className="metrics">{metrics.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      <p className="caption">Distinct file counts. Dependents exclude changed roots. Test associations are not measured coverage.</p>
    </section>
  );
}
