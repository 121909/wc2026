import type { PropsWithChildren, ReactNode } from "react";

export function Section(props: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>{props.title}</h2>
        {props.action}
      </div>
      <div className="section-body">{props.children}</div>
    </section>
  );
}
