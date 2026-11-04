import { useEffect, useState } from "react";

import { loadShellIcon } from "../../lib/fs/shellIcons";
import { fileIcon } from "../../lib/fs/fileIcon";

interface ShellFileIconProps {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size?: number;
}

/**
 * Real Windows association icon (16–32px) with a coloured type badge as a
 * fallback while the icon is being fetched or when Windows has no icon.
 */
export function ShellFileIcon({ name, isDir, isSymlink, size = 16 }: ShellFileIconProps) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isSymlink) {
      setSource(null);
      return;
    }
    void loadShellIcon(name, isDir).then((dataUrl) => {
      if (!cancelled) {
        setSource(dataUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [name, isDir, isSymlink]);

  if (source !== null) {
    return (
      <img
        className="fm-icon-img"
        src={source}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  const fallback = fileIcon(name, isDir, isSymlink);
  if (fallback.kind === "link") {
    return (
      <span className="fm-icon fm-icon--link" aria-hidden="true">
        {fallback.label}
      </span>
    );
  }
  if (fallback.kind === "dir") {
    return <span className="fm-icon fm-icon--dir" aria-hidden="true" />;
  }
  return (
    <span className={`fm-icon fm-icon--file fm-icon--${fallback.tone}`} aria-hidden="true">
      {fallback.label}
    </span>
  );
}
