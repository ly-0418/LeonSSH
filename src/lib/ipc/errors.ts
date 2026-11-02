/** Error normalisation for every command call.
 *
 * Rust commands reject with `{ code, message }` (see `src-tauri/src/error.rs`);
 * infrastructure failures reject with a plain string. Both are folded into a
 * single `IpcError` so the UI never has to branch on shape.
 */

export interface AppErrorPayload {
  code: string;
  message: string;
}

export class IpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IpcError";
    this.code = code;
  }
}

function isPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppErrorPayload).code === "string" &&
    typeof (value as AppErrorPayload).message === "string"
  );
}

export function normalizeError(raw: unknown): IpcError {
  if (raw instanceof IpcError) {
    return raw;
  }
  if (isPayload(raw)) {
    return new IpcError(raw.code, raw.message);
  }
  if (typeof raw === "string") {
    return new IpcError("ipc", raw);
  }
  if (raw instanceof Error) {
    return new IpcError("unknown", raw.message);
  }
  return new IpcError("unknown", "未知错误");
}

export function toUserMessage(raw: unknown): string {
  const error = normalizeError(raw);
  return `[${error.code}] ${error.message}`;
}

/** Human readable hint for the few codes worth special casing. */
export function hintFor(raw: unknown): string | null {
  const error = normalizeError(raw);
  switch (error.code) {
    case "session_not_found":
      return "会话已结束，请重新打开一个终端。";
    case "session_closed":
      return "通道已关闭，输入被丢弃。";
    case "host_key_mismatch":
      return "主机密钥与首次连接时记录的不一致，已拒绝连接。请确认服务器是否重装或是否存在中间人。";
    case "ssh_error":
      return "SSH 连接失败，请检查主机、端口、用户名与密码是否正确。";
    default:
      return null;
  }
}
