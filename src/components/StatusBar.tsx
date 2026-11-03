import type { TerminalStatus } from "../lib/ipc/types";

interface StatusBarProps {
  endpoint: string | null;
  state: TerminalStatus["state"];
}

/** Minimal bottom bar: connection endpoint of the active session. */
export function StatusBar({ endpoint, state }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className={`status-dot status-dot--${state}`} />
      <span className="status-bar__endpoint" title={endpoint ?? "未连接"}>
        {endpoint ?? "未连接"}
      </span>
    </footer>
  );
}
