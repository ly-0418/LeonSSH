import { useEffect } from "react";

export interface FileMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface FileContextMenuProps {
  x: number;
  y: number;
  items: FileMenuItem[];
  onClose: () => void;
}

/** Lightweight context menu for the file tables. */
export function FileContextMenu({ x, y, items, onClose }: FileContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="file-menu"
      style={{ left: x, top: y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`file-menu__item${item.danger === true ? " file-menu__item--danger" : ""}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
