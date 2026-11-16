export interface DeleteItem {
  path: string;
  isDir: boolean;
}

export interface DeletePlan {
  /** Files first, then directories deepest-first (children before parents). */
  items: DeleteItem[];
  /** How many files the folders contain (displayed as the denominator base). */
  fileCount: number;
}

/**
 * Expands the selected entries into individual files and folders so deletion
 * progress can advance per file instead of per top-level selection.
 */
export async function collectDeletePlan(
  roots: DeleteItem[],
  list: (path: string) => Promise<Array<{ path: string; isDir: boolean }>>,
  onCount?: (found: number) => void,
): Promise<DeletePlan> {
  const files: DeleteItem[] = [];
  const dirs: DeleteItem[] = [];
  let found = 0;

  const walk = async (item: DeleteItem): Promise<void> => {
    found += 1;
    if (onCount !== undefined && found % 25 === 0) {
      onCount(found);
    }
    if (!item.isDir) {
      files.push(item);
      return;
    }
    // Recorded before its children; the final list reverses them so parents
    // are removed after they became empty.
    dirs.push(item);
    let children: Array<{ path: string; isDir: boolean }>;
    try {
      children = await list(item.path);
    } catch {
      // Unreadable folder: let the delete call surface the real error.
      return;
    }
    for (const child of children) {
      await walk({ path: child.path, isDir: child.isDir });
    }
  };

  for (const root of roots) {
    await walk(root);
  }
  onCount?.(found);

  return {
    items: [...files, ...dirs.slice().reverse()],
    fileCount: files.length,
  };
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length === 0 ? path : parts[parts.length - 1];
}
