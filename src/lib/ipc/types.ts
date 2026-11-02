/** Shared IPC types. Mirrors the `#[derive(Serialize)]` structs in
 *  `src-tauri/src/commands/`. */

export type TerminalId = string;

export type RendererKind = "webgl" | "dom";

export type SessionState = "connecting" | "ready" | "closed" | "error";

/** A stored connection profile (SQLite row). Never contains a password. */
export interface SessionSummary {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | string;
  color: string | null;
  hasPassword: boolean;
}

export interface SessionInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod?: string;
  privateKeyPath?: string | null;
  color?: string | null;
}

export interface KnownHostEntry {
  endpoint: string;
  fingerprint: string;
  addedAt: string;
}

export interface OpenTerminalResult {
  terminalId: TerminalId;
  sessionId: number;
  title: string;
  cols: number;
  rows: number;
  endpoint: string;
  username: string;
  fingerprint: string;
  /** `match` | `first-use` */
  hostKey: string;
}

export interface AppInfo {
  version: string;
  installDir: string;
  dataDir: string;
  logsDir: string;
  cacheDir: string;
  dataMode: "install-dir" | "user-fallback" | string;
  platform: string;
  arch: string;
  activeSessions: number;
}

export interface TerminalStatus {
  terminalId: TerminalId | null;
  renderer: RendererKind | "pending";
  cols: number;
  rows: number;
  state: SessionState;
  message?: string;
  endpoint?: string;
  fingerprint?: string;
}
