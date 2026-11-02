/** File entry shared by the local and remote panes. */

export interface FileEntry {
  name: string;
  /** Absolute path (Windows path for local, POSIX path for remote). */
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  /** `null` while metadata is still being fetched (local pane hydrates lazily). */
  size: number | null;
  mtimeMs: number | null;
  /** Unix permission bits (remote only). */
  permissions: number | null;
}

export type PaneSide = "local" | "remote";
