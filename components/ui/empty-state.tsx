import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><p className="empty-title">{title}</p><div className="muted">{children}</div></div>;
}
