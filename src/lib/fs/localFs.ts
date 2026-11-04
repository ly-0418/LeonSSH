/** The single entry point for local filesystem access.
 *
 * Everything here goes through `@tauri-apps/plugin-fs`, which enforces the
 * capability scope (widened at startup to the user profile + every drive root).
 * No component may call `invoke` for local paths.
 */

import { invoke } from "@tauri-apps/api/core";
import { desktopDir, homeDir } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, remove, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";

import type { FileEntry } from "./types";
import { joinLocal, normalizeLocal } from "./paths";

const STAT_CONCURRENCY = 8;
/** Huge folders would need thousands of IPC calls; hydrate the first page only. */
const HYDRATE_LIMIT = 300;

/** True when the path exists and is a directory (used by drop handling). */
export async function isLocalDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(normalizeLocal(path));
    return info.isDirectory === true;
  } catch {
    return false;
  }
}

export async function localHome(): Promise<string> {
  const home = await homeDir();
  return normalizeLocal(home.replace(/[\\/]+$/, ""));
}

/** Default browsing location of the local pane: Desktop, falling back to home. */
export async function localDesktop(): Promise<string> {
  try {
    const desktop = await desktopDir();
    const path = normalizeLocal(desktop.replace(/[\\/]+$/, ""));
    if (await exists(path)) {
      return path;
    }
  } catch {
    // Desktop may be redirected/unavailable; fall through to the home dir.
  }
  return localHome();
}

export async function localRoots(): Promise<string[]> {
  return invoke<string[]>("local_roots");
}

export async function createLocalDir(path: string): Promise<void> {
  await mkdir(path);
}

export async function createLocalFile(path: string): Promise<void> {
  await writeTextFile(path, "");
}

export async function renameLocal(from: string, to: string): Promise<void> {
  await rename(from, to);
}

export async function deleteLocal(path: string, isDir: boolean): Promise<void> {
  await remove(path, { recursive: isDir });
}

/** Opens the file with the Windows default application (Notepad fallback). */
export async function openLocalFile(path: string): Promise<void> {
  await invoke("local_open_file", { path });
}

export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export async function listLocal(path: string): Promise<FileEntry[]> {
  const target = normalizeLocal(path);
  const entries = await readDir(target);
  return sortEntries(
    entries.map((entry) => ({
      name: entry.name,
      path: joinLocal(target, entry.name),
      isDir: entry.isDirectory,
      isSymlink: entry.isSymlink,
      size: null,
      mtimeMs: null,
      permissions: null,
    })),
  );
}

/** Fills in size/mtime in the background so big folders render immediately.
 *
 * `readDir` does not return metadata, so this costs one `stat` per entry. A
 * bounded worker pool keeps large directories responsive.
 */
export async function hydrateLocalStats(
  entries: FileEntry[],
  onPatch: (path: string, patch: Partial<FileEntry>) => void,
): Promise<void> {
  const queue = entries.slice(0, HYDRATE_LIMIT);
  if (queue.length === 0) {
    return;
  }

  const workers = Array.from({ length: Math.min(STAT_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (entry === undefined) {
        return;
      }
      try {
        const info = await stat(entry.path);
        onPatch(entry.path, {
          size: entry.isDir ? null : (info.size ?? null),
          mtimeMs: info.mtime ? new Date(info.mtime).getTime() : null,
        });
      } catch {
        // A file may vanish between read_dir and stat; leave the placeholders.
      }
    }
  });

  await Promise.all(workers);
}
