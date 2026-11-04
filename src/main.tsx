import { invoke as __invoke } from "@tauri-apps/api/core";

function reportFrontendError(kind: string, detail: unknown): void {
  const text = kind + ": " + (detail instanceof Error ? detail.message + "\n" + (detail.stack ?? "") : String(detail));
  void __invoke("frontend_error", { message: text }).catch(() => undefined);
}

window.addEventListener("error", (event) => {
  reportFrontendError("error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  reportFrontendError("unhandledrejection", event.reason);
});
import ReactDOM from "react-dom/client";

import "@xterm/xterm/css/xterm.css";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/file-manager.css";
import "./styles/terminal.css";

import App from "./App";

// No <StrictMode> on purpose: its development-only double effect invocation
// would open and immediately close a real backend session (double task, double
// IPC). The session layer itself is written to survive it, but there is no
// value in exercising it on every reload.

// Apply the persisted theme before the first paint (no light->dark flash).
const storedTheme = localStorage.getItem("leonssh.theme");
document.documentElement.dataset.theme = storedTheme === "light" ? "light" : "dark";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root element is missing");
}

ReactDOM.createRoot(container).render(<App />);
