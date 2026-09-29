import type { ReactNode } from "react";

export function Panel({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="panel" aria-labelledby={`${id}-title`}>
      <header className="panel-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}
