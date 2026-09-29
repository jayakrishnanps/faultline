import type { AssociationType } from "../../types/domain/primitives.ts";
import type { ReportPresentation } from "../../types/report-presentation.ts";
import { graphSideLabel } from "../../lib/data/report-presentation.ts";
import { EmptyState } from "../ui/empty-state";
import { Panel } from "../ui/panel";

const associationLabels: Record<AssociationType, string> = {
  dependency_path: "Dependency path", filename: "Filename heuristic", proximity: "Proximity heuristic",
};

export function TestAssociations({ tests }: Pick<ReportPresentation, "tests">) {
  return <Panel id="test-associations" title="Tests" description="Associations identify tests to inspect. No tests have been run for this report, and coverage has not been measured.">
    {tests.length ? <ul className="record-list">{tests.map((test, index) => <li key={`${test.graphSide}:${index}`}>
      <code>{test.testPath}</code><p className="caption">{associationLabels[test.associationType]} · {graphSideLabel(test.graphSide)} evidence for <code>{test.targetPath}</code></p>
    </li>)}</ul> : <EmptyState title="No test associations supplied"><p>Test discovery is incomplete. Absence of an association is not proof that a file is untested.</p></EmptyState>}
  </Panel>;
}
