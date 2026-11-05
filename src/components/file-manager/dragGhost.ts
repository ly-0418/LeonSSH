/** Windows-like drag ghost: a small badge showing how many items are dragged. */
export function setDragGhost(event: React.DragEvent, count: number, label?: string): void {
  if (count <= 0) {
    return;
  }
  const ghost = document.createElement("div");
  ghost.className = "fm-drag-ghost";
  ghost.textContent = count > 1 ? `${count} 个项目` : (label ?? "1 个项目");
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  // The browser snapshots the node synchronously; remove it on the next tick.
  window.setTimeout(() => ghost.remove(), 0);
}
