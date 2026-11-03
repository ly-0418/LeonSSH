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
