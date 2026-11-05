/** Windows-like drag badge: type icons (stacked when mixed) plus a count. */

import { iconKey, loadShellIcon } from "../../lib/fs/shellIcons";

export interface DragBadgeItem {
  name: string;
  isDir: boolean;
  isSymlink?: boolean;
}

let ghost: HTMLDivElement | null = null;

export function ensureGhost(): HTMLDivElement {
  if (ghost === null) {
    ghost = document.createElement("div");
    ghost.className = "fm-drag-ghost";
    document.body.appendChild(ghost);
  }
  return ghost;
}

export function removeGhost(): void {
  ghost?.remove();
  ghost = null;
}

export function moveGhost(x: number, y: number): void {
  if (ghost !== null) {
    ghost.style.left = `${x + 16}px`;
    ghost.style.top = `${y + 16}px`;
  }
}

function iconFrame(name: string, isDir: boolean): HTMLElement {
  const frame = document.createElement("span");
  frame.className = "fm-drag-badge__icon";
  const fallback = () => {
    frame.textContent = isDir ? "📁" : "📄";
  };
  void loadShellIcon(name, isDir)
    .then((source) => {
      if (source === null) {
        fallback();
        return;
      }
      const image = document.createElement("img");
      image.src = source;
      image.alt = "";
      image.draggable = false;
      frame.appendChild(image);
    })
    .catch(fallback);
  return frame;
}

/**
 * Fills the badge: one item shows its type icon, several items show up to three
 * distinct type icons stacked together with the total count in the middle.
 */
export function fillGhost(items: DragBadgeItem[]): void {
  const element = ensureGhost();
  element.replaceChildren();

  const distinct: DragBadgeItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = iconKey(item.name, item.isDir, item.isSymlink === true);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    distinct.push(item);
    if (distinct.length === 3) {
      break;
    }
  }

  const stack = document.createElement("span");
  stack.className = "fm-drag-badge__stack";
  distinct.forEach((item, index) => {
    const frame = iconFrame(item.name, item.isDir);
    // Symmetric offsets keep the icon group visually centred in the frame.
    const offset = index === 0 ? 0 : index === 1 ? 8 : -8;
    frame.style.setProperty("--offset", `${offset}px`);
    stack.appendChild(frame);
  });
  element.appendChild(stack);

  if (items.length > 1) {
    const count = document.createElement("span");
    count.className = "fm-drag-badge__count";
    count.textContent = String(items.length);
    element.appendChild(count);
  }
}

export function setGhostPosition(x: number, y: number): void {
  const element = ensureGhost();
  element.style.left = `${x + 16}px`;
  element.style.top = `${y + 16}px`;
}
