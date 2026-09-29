import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ConnectionStatus } from "@/components/repository/connection-status";

export const metadata: Metadata = { title: "Repositories | Faultline" };

export default function RepositoriesPage() {
  return <AppShell active="repositories">
    <header className="page-heading"><p className="eyebrow">Connection status</p><h1>Repositories</h1><p className="lede">A place for repository connections once sign-in and GitHub access are implemented.</p></header>
    <ConnectionStatus />
    <Panel id="repository-list" title="Repository list" description="This is a placeholder. No authenticated repository request has been made.">
      <EmptyState title="Repositories have not been loaded">
        <p>The list will become available after the connection flow is implemented. The demo-store example is local fixture data, not a connected repository.</p>
        <Link className="text-link" href="/demo">Open the local demonstration <span aria-hidden="true">→</span></Link>
      </EmptyState>
    </Panel>
  </AppShell>;
}
