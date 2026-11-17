import { useState, type ReactNode } from "react";

import { ChevronDownIcon } from "./icons";

interface CollapsibleGroupProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** A settings section with a clickable header that folds its contents. */
export function CollapsibleGroup({ title, children, defaultOpen = true }: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`setting-group${open ? "" : " setting-group--collapsed"}`}>
      <button
        type="button"
        className="setting-group__head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="setting-group__title">{title}</span>
        <span className="setting-group__chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      {open && <div className="setting-group__body">{children}</div>}
    </section>
  );
}
