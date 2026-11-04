import { invoke } from "@tauri-apps/api/core";

interface ShellIcon {
  width: number;
  height: number;
  bgra: number[];
}

/** One data URL per file type: the shell association is extension based. */
const cache = new Map<string, Promise<string | null>>();

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function iconKey(name: string, isDir: boolean, isSymlink: boolean): string {
  if (isSymlink) {
    return "link";
  }
  if (isDir) {
    return "dir";
  }
  return extensionOf(name) || "file";
}

function toDataUrl(icon: ShellIcon): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = icon.width;
  canvas.height = icon.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  const image = context.createImageData(icon.width, icon.height);
  for (let i = 0; i < icon.width * icon.height; i += 1) {
    image.data[i * 4] = icon.bgra[i * 4 + 2] ?? 0;
    image.data[i * 4 + 1] = icon.bgra[i * 4 + 1] ?? 0;
    image.data[i * 4 + 2] = icon.bgra[i * 4] ?? 0;
    image.data[i * 4 + 3] = icon.bgra[i * 4 + 3] ?? 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Windows shell icon for this file type (Notepad for .txt, Typora for .md…),
 * loaded once per extension and reused for every row.
 */
export function loadShellIcon(name: string, isDir: boolean): Promise<string | null> {
  const key = iconKey(name, isDir, false);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const request = invoke<ShellIcon>("shell_icon", {
    name: isDir ? "folder" : `file.${key}`,
    isDir,
  })
    .then((icon) => toDataUrl(icon))
    .catch(() => null);
  cache.set(key, request);
  return request;
}
