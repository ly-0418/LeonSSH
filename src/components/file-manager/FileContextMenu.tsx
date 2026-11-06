import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

export interface FileMenuItem {
  label: string;
  /** Segoe Fluent Icons glyph shown on the left of the label. */
  icon?: string;
  danger?: boolean;
  onSelect: () => void;
}

interface FileContextMenuProps {
  x: number;
  y: number;
  items: FileMenuItem[];
  onClose: () => void;
}

const ITEM_HEIGHT = 32;
const MENU_WIDTH = 208;

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

  // Keep the menu inside the window (a click near the bottom edge would
  // otherwise open it half off-screen).
  const position = useMemo(() => {
    const height = items.length * ITEM_HEIGHT + 8;
    const left = Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
    const top = Math.max(4, Math.min(y, window.innerHeight - height - 8));
    return { left, top };
  }, [x, y, items.length]);

  const menu = (
    <div
      className="file-menu"
      style={position}
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
          {item.icon !== undefined && <span className="file-menu__icon">{item.icon}</span>}
          <span className="file-menu__label">{item.label}</span>
        </button>
      ))}
    </div>
  );

  // Rendered into <body>: the file manager uses `will-change: transform`, which
  // would otherwise make it the containing block for `position: fixed`.
  return createPortal(menu, document.body);
}
