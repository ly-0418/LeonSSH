/**
 * Session-scoped memory for the file transfer panes.
 *
 * Deliberately in-memory only: the state lives as long as the app runs, so a
 * closed session starts fresh and nothing survives a restart.
 */
const store = new Map<string, string>();

export function memGet(key: string): string | null {
  return store.get(key) ?? null;
}

export function memSet(key: string, value: string): void {
  store.set(key, value);
}

/** Drops every entry of one session (called when its tab closes). */
export function memClearPrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
