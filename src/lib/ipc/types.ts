/** Shared IPC types. Mirrors the `#[derive(Serialize)]` structs in
 *  `src-tauri/src/commands/ssh.rs`. */

export type SessionId = string;

export type RendererKind = "webgl" | "dom";

export type SessionState = "connecting" | "ready" | "closed" | "error";

export interface OpenSessionResult {
  sessionId: SessionId;
  title: string;
  cols: number;
  rows: number;
  /** `ssh` for a real connection, `fake` for the built-in demo source. */
  transport: string;
  endpoint: string;
  username: string;
  fingerprint: string;
  /** `match` | `first-use` | `fake` */
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
  sessionId: SessionId | null;
  renderer: RendererKind | "pending";
  cols: number;
  rows: number;
  state: SessionState;
  message?: string;
  endpoint?: string;
  fingerprint?: string;
}
