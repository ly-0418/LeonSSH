/** Maps a file name to a coloured type badge so the lists read like an IDE. */

interface IconSpec {
  label: string;
  tone: string;
}

const BY_EXTENSION: Record<string, IconSpec> = {
  ts: { label: "TS", tone: "blue" },
  tsx: { label: "TS", tone: "blue" },
  js: { label: "JS", tone: "yellow" },
  jsx: { label: "JS", tone: "yellow" },
  json: { label: "{}", tone: "yellow" },
  html: { label: "<>", tone: "orange" },
  css: { label: "CSS", tone: "blue" },
  scss: { label: "CSS", tone: "pink" },
  md: { label: "MD", tone: "slate" },
  txt: { label: "TXT", tone: "slate" },
  log: { label: "LOG", tone: "slate" },
  sh: { label: "SH", tone: "green" },
  bash: { label: "SH", tone: "green" },
  py: { label: "PY", tone: "blue" },
  rs: { label: "RS", tone: "orange" },
  go: { label: "GO", tone: "cyan" },
  java: { label: "JV", tone: "red" },
  c: { label: "C", tone: "blue" },
  h: { label: "H", tone: "blue" },
  cpp: { label: "C+", tone: "blue" },
  cs: { label: "C#", tone: "purple" },
  php: { label: "PHP", tone: "purple" },
  rb: { label: "RB", tone: "red" },
  sql: { label: "SQL", tone: "cyan" },
  yml: { label: "YML", tone: "pink" },
  yaml: { label: "YML", tone: "pink" },
  toml: { label: "TML", tone: "slate" },
  ini: { label: "INI", tone: "slate" },
  conf: { label: "CFG", tone: "slate" },
  png: { label: "IMG", tone: "green" },
  jpg: { label: "IMG", tone: "green" },
  jpeg: { label: "IMG", tone: "green" },
  gif: { label: "IMG", tone: "green" },
  svg: { label: "SVG", tone: "orange" },
  webp: { label: "IMG", tone: "green" },
  ico: { label: "ICO", tone: "green" },
  pdf: { label: "PDF", tone: "red" },
  doc: { label: "DOC", tone: "blue" },
  docx: { label: "DOC", tone: "blue" },
  xls: { label: "XLS", tone: "green" },
  xlsx: { label: "XLS", tone: "green" },
  ppt: { label: "PPT", tone: "orange" },
  pptx: { label: "PPT", tone: "orange" },
  zip: { label: "ZIP", tone: "yellow" },
  gz: { label: "GZ", tone: "yellow" },
  tar: { label: "TAR", tone: "yellow" },
  "7z": { label: "7Z", tone: "yellow" },
  rar: { label: "RAR", tone: "yellow" },
  exe: { label: "EXE", tone: "purple" },
  msi: { label: "MSI", tone: "purple" },
  dll: { label: "DLL", tone: "slate" },
  bat: { label: "BAT", tone: "green" },
  ps1: { label: "PS1", tone: "blue" },
  pem: { label: "KEY", tone: "red" },
  key: { label: "KEY", tone: "red" },
  crt: { label: "CRT", tone: "red" },
  env: { label: "ENV", tone: "orange" },
  lock: { label: "LCK", tone: "slate" },
};

const BY_NAME: Record<string, IconSpec> = {
  dockerfile: { label: "DOC", tone: "cyan" },
  "docker-compose.yml": { label: "CMP", tone: "cyan" },
  makefile: { label: "MK", tone: "orange" },
  ".gitignore": { label: "GIT", tone: "orange" },
  ".env": { label: "ENV", tone: "orange" },
  "package.json": { label: "NPM", tone: "red" },
  "cargo.toml": { label: "RS", tone: "orange" },
  "readme.md": { label: "MD", tone: "slate" },
};

export interface FileIconSpec {
  /** Folder, link or the type badge. */
  kind: "dir" | "link" | "file";
  label: string;
  tone: string;
}

export function fileIcon(name: string, isDir: boolean, isSymlink: boolean): FileIconSpec {
  if (isSymlink) {
    return { kind: "link", label: "↗", tone: "cyan" };
  }
  if (isDir) {
    return { kind: "dir", label: "", tone: "folder" };
  }
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName !== undefined) {
    return { kind: "file", ...byName };
  }
  const dot = lower.lastIndexOf(".");
  const extension = dot > 0 ? lower.slice(dot + 1) : "";
  const byExt = BY_EXTENSION[extension];
  if (byExt !== undefined) {
    return { kind: "file", ...byExt };
  }
  return { kind: "file", label: extension.slice(0, 3).toUpperCase() || "•", tone: "slate" };
}
