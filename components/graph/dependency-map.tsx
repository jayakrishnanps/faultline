import type { ReportPresentation, PresentationNode } from "../../types/report-presentation.ts";
import { graphSideLabel } from "../../lib/data/report-presentation.ts";
import { EmptyState } from "../ui/empty-state";
import { Panel } from "../ui/panel";

export function DependencyMap({ report }: { report: ReportPresentation }) {
  const groups: { title: string; nodes: readonly PresentationNode[] }[] = [
    { title: "Changed", nodes: report.nodes.filter((node) => node.isChanged) },
    { title: "Direct", nodes: report.nodes.filter((node) => node.distance === 1) },
    { title: "Indirect", nodes: report.nodes.filter((node) => node.distance !== null && node.distance > 1) },
    { title: "Not reached", nodes: report.nodes.filter((node) => node.distance === null) },
  ];
  return (
    <Panel id="dependency-map" title="Dependency map" description="A static map of the supplied relationships. Read the import evidence below each group.">
      {report.nodes.length === 0 ? <EmptyState title="No graph data supplied"><p>File relationships will appear here when an analysis provides them.</p></EmptyState> : (
        <figure className="dependency-figure">
          <figcaption className="caption">{report.provenance.kind === "presentation_sample" ? "Hand-authored sample graph" : "Report graph"} · {report.nodes.length} nodes · traversal depth {report.traversal.maxDepth}</figcaption>
          <div className="graph-groups">
            {groups.map((group) => <section key={group.title} className="graph-group" aria-label={`${group.title} files`}>
              <h3>{group.title} <span className="muted">{group.nodes.length}</span></h3>
              {group.nodes.length ? <ul className="node-list">{group.nodes.map((node) => <li key={`${node.graphSide}:${node.path}`} className={node.isChanged ? "graph-node graph-node-changed" : "graph-node"}>
                <code>{node.path}</code><span className="node-detail">{graphSideLabel(node.graphSide)} · {node.distance === null ? "Outside this reach" : `Distance ${node.distance}`}</span>
              </li>)}</ul> : <p className="caption">No files in this group.</p>}
            </section>)}
          </div>
          <details className="edge-disclosure">
            <summary>Inspect {report.edges.length} directed relationships</summary>
            <p className="caption">Displayed impact runs from an imported module to its importer. Stored imports run in the opposite direction.</p>
            {report.edges.length ? <ul className="edge-list">{report.edges.map((edge, index) => <li key={`${edge.graphSide}:${index}`}>
              <code>{edge.displayedImpact.from}</code><span><span aria-hidden="true">→</span><span className="sr-only">can reach importer</span></span><code>{edge.displayedImpact.to}</code>
              <span className="node-detail">{graphSideLabel(edge.graphSide)} evidence</span>
            </li>)}</ul> : <p className="caption">No dependency edges supplied.</p>}
          </details>
          {report.traversal.truncated && <p className="notice-title">Traversal stopped at the depth limit; additional dependents may exist.</p>}
        </figure>
      )}
    </Panel>
  );
}
