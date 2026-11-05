/** Windows-like drag ghost: a badge that follows the cursor while dragging. */

let ghost: HTMLDivElement | null = null;
let cleanupBound = false;

function ensureGhost(): HTMLDivElement {
  if (ghost === null) {
    ghost = document.createElement("div");
    ghost.className = "fm-drag-ghost";
    document.body.appendChild(ghost);
  }
  return ghost;
}

function removeGhost(): void {
  ghost?.remove();
  ghost = null;
}

/**
 * Shows "N 个项目" next to the cursor. The element must stay in the DOM for the
 * whole drag: removing it on the next tick makes Chromium drop the drag image
 * and the drop target then rejects the drag (no-drop cursor).
 */
export function setDragGhost(event: React.DragEvent, count: number, label?: string): void {
  if (count <= 0) {
    return;
  }
  const element = ensureGhost();
  element.textContent = count > 1 ? `${count} 个项目` : (label ?? "1 个项目");
  element.style.left = `${event.clientX + 14}px`;
  element.style.top = `${event.clientY + 14}px`;
  event.dataTransfer.setDragImage(element, 12, 12);

  if (!cleanupBound) {
    cleanupBound = true;
    const stop = () => {
      cleanupBound = false;
      window.removeEventListener("dragend", stop, true);
      window.removeEventListener("drop", stop, true);
      removeGhost();
    };
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", stop, true);
  }
}
