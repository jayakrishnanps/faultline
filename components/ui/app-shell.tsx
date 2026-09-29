import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { key: "home", href: "/", label: "Overview" },
  { key: "repositories", href: "/repositories", label: "Repositories" },
  { key: "demo", href: "/demo", label: "Local demo" },
] as const;

export function AppShell({ active, children }: { active: typeof navigation[number]["key"]; children: ReactNode }) {
  return (
    <>
      <header className="site-header container">
        <Link className="wordmark" href="/" aria-label="Faultline home"><span aria-hidden="true">╱</span> Faultline</Link>
        <nav aria-label="Main navigation">
          <ul className="nav-list">
            {navigation.map((item) => <li key={item.key}><Link href={item.href} aria-current={active === item.key ? "page" : undefined}>{item.label}</Link></li>)}
          </ul>
        </nav>
        <span className="badge">Local preview</span>
      </header>
      <main id="main" tabIndex={-1} className="container main-content">{children}</main>
      <footer className="site-footer container">
        <span>Faultline · Source-level dependency evidence</span>
        <span>GitHub connection and sign-in are not available yet.</span>
      </footer>
    </>
  );
}
