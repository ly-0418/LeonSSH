/** Shared "update available" state.
 *
 * The silent startup check (App) and the manual check (settings tab) both feed
 * this store; the status bar subscribes so the blue badge appears no matter
 * which check found the new version.
 */

import type { UpdateInfo } from "./update";

type Listener = (info: UpdateInfo | null) => void;

let current: UpdateInfo | null = null;
const listeners = new Set<Listener>();

export function setAvailableUpdate(info: UpdateInfo | null): void {
  current = info;
  for (const listener of listeners) {
    listener(info);
  }
}

export function getAvailableUpdate(): UpdateInfo | null {
  return current;
}

export function subscribeAvailableUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
