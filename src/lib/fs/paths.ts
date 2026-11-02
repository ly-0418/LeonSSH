/** Path helpers that keep Windows drive roots intact.
 *
 * Tauri's fs plugin hands us OS paths; we never build them with template
 * strings sprinkled through components.
 */

const DRIVE_ROOT = /^[A-Za-z]:[\\/]?$/;

export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

export function isDriveRoot(path: string): boolean {
  return DRIVE_ROOT.test(path);
}

/** Collapses duplicated separators, keeps the drive prefix and root slash. */
export function normalizeLocal(path: string): string {
  if (!path) {
    return path;
  }
  const separator = path.includes("\\") ? "\\" : "/";
  const prefix = /^[A-Za-z]:/.test(path) ? path.slice(0, 2) : "";
  const rest = path
    .slice(prefix.length)
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(separator);

  if (!prefix) {
    return rest ? `/${rest}` : "/";
  }
  return rest ? `${prefix}${separator}${rest}` : `${prefix}${separator}`;
}

export function joinLocal(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  if (dir.endsWith("\\") || dir.endsWith("/")) {
    return `${dir}${name}`;
  }
  return `${dir}${separator}${name}`;
}

export function parentLocal(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (isDriveRoot(`${trimmed}\\`)) {
    return `${trimmed}\\`;
  }
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (index < 0) {
    return trimmed;
  }
  const parent = trimmed.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent.length === 0 ? "/" : parent;
}

export interface Crumb {
  label: string;
  path: string;
}

export function breadcrumbs(path: string): Crumb[] {
  if (isWindowsPath(path)) {
    const drive = path.slice(0, 2).toUpperCase();
    const rest = path.slice(2).replace(/^[\\/]+/, "");
    const parts = rest.split(/[\\/]/).filter(Boolean);
    const crumbs: Crumb[] = [{ label: `${drive}\\`, path: `${drive}\\` }];
    let current = `${drive}\\`;
    for (const part of parts) {
      current = joinLocal(current, part);
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  }
  const parts = path.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

export function fileName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
