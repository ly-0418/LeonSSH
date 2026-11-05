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

interface LoadedIcon {
  element: HTMLElement;
  /** Rendered width in px; used to stack the smallest icons on top. */
  loaded: Promise<number>;
}

function iconFrame(name: string, isDir: boolean): LoadedIcon {
  const frame = document.createElement("span");
  frame.className = "fm-drag-badge__icon";

  const fallback = (): number => {
    frame.textContent = isDir ? "📁" : "📄";
    return 22;
  };

  const loaded = loadShellIcon(name, isDir)
    .then(
      (source) =>
        new Promise<number>((resolve) => {
          if (source === null) {
            resolve(fallback());
            return;
          }
          const image = document.createElement("img");
          image.draggable = false;
          image.alt = "";
          image.onload = () => resolve(image.naturalWidth || 32);
          image.onerror = () => resolve(fallback());
          image.src = source;
          frame.appendChild(image);
        }),
    )
    .catch(() => fallback());

  return { element: frame, loaded };
}

/**
 * Fills the badge: one item shows its type icon, several items show up to three
 * distinct types stacked with the total count centred. Icons are ordered by
 * size so the smallest one ends up on top (Windows-like layering).
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
  element.appendChild(stack);

  const frames = distinct.map((item) => iconFrame(item.name, item.isDir));
  void Promise.all(frames.map((frame) => frame.loaded)).then((sizes) => {
    // Largest first: later siblings paint on top, so the smallest icon wins.
    const ordered = frames
      .map((frame, index) => ({ frame, size: sizes[index] }))
      .sort((a, b) => b.size - a.size);
    ordered.forEach(({ frame }, index) => {
      const offset = index === 0 ? 0 : index === 1 ? 8 : -8;
      frame.element.style.setProperty("--offset", `${offset}px`);
      frame.element.style.zIndex = String(ordered.length - index);
      stack.appendChild(frame.element);
    });
  });

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
