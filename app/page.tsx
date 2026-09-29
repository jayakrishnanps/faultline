import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";
import { ConnectionStatus } from "@/components/repository/connection-status";

export default function Home() {
  return <AppShell active="home">
    <section className="hero" aria-labelledby="headline">
      <p className="eyebrow">Source-level dependency evidence</p>
      <h1 id="headline">See how far<br />a change reaches.</h1>
      <p className="lede">Faultline is being built to trace the files that depend on a pull request’s changes, with paths you can inspect.</p>
      <p className="muted">Start with the local demonstration. Connected repository analysis is not available yet.</p>
      <div className="actions"><Link className="button" href="/demo">Explore the local demo <span aria-hidden="true">→</span></Link><Link className="text-link" href="/repositories">Repository connection status</Link></div>
    </section>
    <section className="overview-section" aria-labelledby="overview-title">
      <h2 id="overview-title">Evidence before conclusions</h2>
      <div className="overview-grid">
        <div><h3>Start with the change</h3><p>Keep the full pull request diff and its revision in view.</p></div>
        <div><h3>Follow the dependency</h3><p>Trace from changed modules to the files that import them.</p></div>
        <div><h3>Inspect the path</h3><p>Review structural evidence without mistaking it for a predicted failure or test coverage.</p></div>
      </div>
    </section>
    <ConnectionStatus />
  </AppShell>;
}
