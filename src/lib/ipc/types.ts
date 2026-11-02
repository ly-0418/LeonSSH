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
  transport: string;
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
}
