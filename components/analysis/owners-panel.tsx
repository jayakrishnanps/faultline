import type { ReportPresentation } from "../../types/report-presentation.ts";
import { EmptyState } from "../ui/empty-state";
import { Panel } from "../ui/panel";

export function OwnersPanel({ owners }: Pick<ReportPresentation, "owners">) {
  return <Panel id="owners" title="Owners" description="Ownership evidence will be kept separate from dependency reach.">
    {owners.state === "unavailable" ? <EmptyState title="Ownership is not available"><p>{owners.explanation}</p></EmptyState>
      : owners.assignments.length ? <ul className="record-list">{owners.assignments.map((assignment) => <li key={assignment.path}><code>{assignment.path}</code><p>{assignment.owners.length ? assignment.owners.join(", ") : "No matching owner supplied."}</p></li>)}</ul>
        : <EmptyState title="No owner assignments supplied"><p>No ownership conclusions can be drawn from this report.</p></EmptyState>}
  </Panel>;
}
