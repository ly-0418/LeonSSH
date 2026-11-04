/** Everything xterm-related lives behind this class.
 *
 * Responsibilities:
 *  - own the `Terminal` instance, the fit addon and the WebGL renderer
 *  - bind the Tauri binary `Channel` to `term.write`
 *  - forward `term.onData` to the `ssh_write` command
 *  - debounce container resizes, fit, then report cols/rows via `ssh_resize`
 *  - dispose in the right order (stop input -> close terminal -> dispose xterm)
 *
 * It is framework-agnostic on purpose: the React hook is a thin lifecycle
 * wrapper so this logic stays testable and multiple tabs share it.
 */

import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";

import { toUserMessage } from "../ipc/errors";
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from "../ipc/session";
import type { RendererKind, TerminalId, TerminalStatus } from "../ipc/types";
import { installRenderer, type RendererController } from "./renderer";
import { TERMINAL_OPTIONS, terminalTheme, type ThemeMode } from "./theme";

const FIT_DEBOUNCE_MS = 60;
const MIN_COLS = 20;
const MIN_ROWS = 5;

export interface TerminalSessionOptions {
  container: HTMLElement;
  /** SQLite row id of the connection profile. */
  sessionId: number;
  title: string;
  /** UI theme at creation time; later changes go through `setTheme`. */
  theme?: ThemeMode;
  fontSize?: number;
  cursorStyle?: "bar" | "underline";
  cursorWidth?: number;
  onStatus?: (patch: Partial<TerminalStatus>) => void;
  onNotice?: (message: string) => void;
  /** Reports the text typed since the last Enter (for autocompletion). */
  onInputLine?: (line: string) => void;
  /** Fires when Enter submits a non-empty line (for usage counting). */
  onExecuted?: (line: string) => void;
}

type BroadcastHandler = (data: string) => void;
type SuggestionKeyHandler = (event: KeyboardEvent) => boolean;
let suggestionKeyHandler: SuggestionKeyHandler | null = null;

/** Lets the completion popup intercept Tab/Enter/Arrows before xterm does. */
export function setSuggestionKeyHandler(handler: SuggestionKeyHandler | null): void {
  suggestionKeyHandler = handler;
}
let broadcastHandler: BroadcastHandler | null = null;

/** Registers the "type once, send everywhere" handler (null disables it). */
export function setBroadcastHandler(handler: BroadcastHandler | null): void {
  broadcastHandler = handler;
}

export class TerminalSession {
  private readonly terminal: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly searchAddon = new SearchAddon();
  private inputLine = "";
  /** Set when Tab/Enter accepted a completion, so the same Enter is not sent. */
  private pendingEnterSuppress = false;
  /** A fresh channel per connection: reusing one after close drops output. */
  private channel: Channel<ArrayBuffer> | null = null;
  private readonly encoder = new TextEncoder();
  private renderer: RendererController | null = null;
  private observer: ResizeObserver | null = null;
  private fitTimer: number | null = null;
  private terminalId: TerminalId | null = null;
  private disposed = false;
  private visible = true;
  private lastCols = 0;
  private lastRows = 0;
  private readonly bytesIn = { value: 0 };
  private bytesOut = 0;

  constructor(private readonly options: TerminalSessionOptions) {
    this.terminal = new Terminal({
      ...TERMINAL_OPTIONS,
      fontSize: options.fontSize ?? 14,
      cursorStyle: options.cursorStyle ?? "bar",
      cursorWidth: options.cursorWidth ?? 2,
      theme: terminalTheme(options.theme ?? "dark"),
    });
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.open(options.container);

    this.renderer = installRenderer(this.terminal, (kind: RendererKind, reason: string) => {
      this.options.onStatus?.({ renderer: kind });
      if (kind === "dom" && reason !== "webgl2-unavailable") {
        this.options.onNotice?.(`WebGL 渲染不可用，已回退 DOM（${reason}）`);
      }
    });
    // Clipboard: Ctrl+C copies when text is selected (otherwise it stays SIGINT),
    // Ctrl+V pastes from the system clipboard into the shell.
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.key === "Tab" || event.key === "Enter") &&
        suggestionKeyHandler === null
      ) {
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("frontend_error", { message: `suggest-null key=${event.key}` }),
        );
      }
      if (event.type === "keydown" && (event.key === "Tab" || event.key === "Enter")) {
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("frontend_error", {
            message: `key-probe key=${event.key} handler=${suggestionKeyHandler !== null}`,
          }),
        );
      }
      if (event.type === "keydown" && suggestionKeyHandler?.(event) === true) {
        if (event.key === "Enter") {
          this.pendingEnterSuppress = true;
        }
        return false;
      }
      if (event.type !== "keydown" || !event.ctrlKey || event.altKey) {
        return true;
      }
      const key = event.key.toLowerCase();
      if (key === "c" && this.terminal.hasSelection()) {
        const text = this.terminal.getSelection();
        if (text.length > 0) {
          void navigator.clipboard.writeText(text).catch(() => undefined);
          this.terminal.clearSelection();
        }
        return false;
      }
      if (key === "v") {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text.length > 0) {
              this.terminal.paste(text);
            }
          })
          .catch(() => undefined);
        return false;
      }
      return true;
    });

    this.terminal.onData((data) => {
      if (this.pendingEnterSuppress && (data === "\r" || data === "\n")) {
        this.pendingEnterSuppress = false;
        return;
      }
      this.pendingEnterSuppress = false;
      this.trackInput(data);
      void this.handleInput(data);
      broadcastHandler?.(data);
    });

    this.observeSize();
    this.fitNow();
    void this.connect();
  }

  // ------------------------------------------------------------- lifecycle

  private async connect(): Promise<void> {
    // The handler must be installed *before* the channel is handed to invoke,
    // otherwise the first frames (the initial paint) would be dropped.
    this.channel = new Channel<ArrayBuffer>();
    this.channel.onmessage = (payload: ArrayBuffer) => this.handleOutput(payload);

    try {
      const result = await openTerminal({
        sessionId: this.options.sessionId,
        channel: this.channel ?? new Channel<ArrayBuffer>(),
        cols: Math.max(MIN_COLS, this.terminal.cols),
        rows: Math.max(MIN_ROWS, this.terminal.rows),
      });

      if (this.disposed) {
        void closeTerminal(result.terminalId).catch(() => undefined);
        return;
      }

      this.terminalId = result.terminalId;
      this.options.onStatus?.({
        terminalId: result.terminalId,
        state: "ready",
        // Report what the backend actually got, not the unclamped fit result
        // (the terminal may still be hidden behind the file manager view).
        cols: Math.max(MIN_COLS, this.terminal.cols),
        rows: Math.max(MIN_ROWS, this.terminal.rows),
        endpoint: result.endpoint,
        fingerprint: result.fingerprint,
      });
      // The initial fit may have happened before the session existed; make
      // sure the backend starts with the real size.
      this.pushSize(true);
      if (this.visible) {
        this.terminal.focus();
      }
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.options.onStatus?.({ state: "error", message: toUserMessage(error) });
      this.terminal.writeln(`\r\n\x1b[31m连接失败：${toUserMessage(error)}\x1b[0m`);
    }
  }

  /** Re-opens the SSH session inside this terminal, keeping the scrollback. */
  async reconnect(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.terminalId !== null) {
      const previous = this.terminalId;
      this.terminalId = null;
      void closeTerminal(previous).catch(() => undefined);
    }
    this.terminal.writeln("\r\n\x1b[2m—— 正在重新连接 ——\x1b[0m");
    await this.connect();
  }

  /** Pixel box of the text cursor inside the terminal container. */
  getCursorBox(): { left: number; top: number; cellHeight: number; width: number; height: number } | null {
    if (this.disposed) {
      return null;
    }
    const element = this.terminal.element ?? this.options.container;
    if (element === null) {
      return null;
    }
    const buffer = this.terminal.buffer.active;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const cellWidth = width / Math.max(1, this.terminal.cols);
    const cellHeight = height / Math.max(1, this.terminal.rows);
    return {
      left: buffer.cursorX * cellWidth,
      top: buffer.cursorY * cellHeight,
      cellHeight,
      width,
      height,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;

    if (this.channel !== null) {
      this.channel.onmessage = () => undefined;
    }

    const terminalId = this.terminalId;
    this.terminalId = null;

    this.renderer?.dispose();
    this.renderer = null;

    if (terminalId !== null) {
      try {
        await closeTerminal(terminalId);
      } catch {
        // The backend may already have dropped the terminal (window closing).
      }
    }

    this.terminal.dispose();
  }

  // ----------------------------------------------------------- visibility

  /** Hidden tabs stay mounted (scrollback preserved) but must not measure. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible || this.disposed) {
      return;
    }
    window.requestAnimationFrame(() => {
      this.fitNow();
      // Repaint the whole viewport so the cursor and the IME anchor are placed
      // against the current layout, not the one from before the view switch.
      this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
      this.terminal.focus();
    });
  }

  /** Applies the cursor shape/width chosen in the settings drawer. */
  setCursorStyle(style: "bar" | "underline", width: number): void {
    if (this.disposed) {
      return;
    }
    this.terminal.options.cursorStyle = style;
    this.terminal.options.cursorWidth = Math.min(6, Math.max(1, width));
  }

  /** Changes the terminal font size and refits the viewport. */
  setFontSize(size: number): void {
    if (this.disposed || this.terminal.options.fontSize === size) {
      return;
    }
    this.terminal.options.fontSize = size;
    this.fitNow();
    this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
  }

  /** Scrolls to the next buffer match (search bar). */
  findNext(text: string): void {
    if (!this.disposed && text.length > 0) {
      this.searchAddon.findNext(text);
    }
  }

  /** Scrolls to the previous buffer match. */
  findPrevious(text: string): void {
    if (!this.disposed && text.length > 0) {
      this.searchAddon.findPrevious(text);
    }
  }

  /** Swaps the xterm palette without recreating the terminal. */
  setTheme(mode: ThemeMode): void {
    if (this.disposed) {
      return;
    }
    this.terminal.options.theme = terminalTheme(mode);
    this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
  }

  // ----------------------------------------------------------- I/O plumbing

  /** Keeps a rough copy of the line being typed so the UI can suggest commands. */
  private trackInput(data: string): void {
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        if (this.inputLine.trim().length > 0) {
          this.options.onExecuted?.(this.inputLine);
        }
        this.inputLine = "";
      } else if (char === "\x03") {
        this.inputLine = "";
      } else if (char === "\x7f") {
        this.inputLine = this.inputLine.slice(0, -1);
      } else if (char >= " ") {
        this.inputLine += char;
      }
    }
    this.options.onInputLine?.(this.inputLine);
  }

  /** Sends a bare Enter to the shell (used after filling in a completion). */
  async sendEnter(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.inputLine = "";
    this.options.onInputLine?.("");
    await this.handleInput("\r");
  }

  /** Sends `count` backspaces to the shell and trims the tracked line. */
  async backspace(count: number): Promise<void> {
    if (this.disposed || count <= 0 || this.terminalId === null) {
      return;
    }
    this.inputLine = this.inputLine.slice(0, Math.max(0, this.inputLine.length - count));
    this.options.onInputLine?.(this.inputLine);
    await this.handleInput("\x7f".repeat(count));
  }

  /** Replaces the last `remove` characters of the current line with `text`. */
  async replaceSuffix(remove: number, text: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    const trimmed = this.inputLine.slice(0, Math.max(0, this.inputLine.length - remove));
    this.inputLine = trimmed + text;
    this.options.onInputLine?.(this.inputLine);
    if (text.length > 0) {
      await this.handleInput("\x7f".repeat(remove) + text);
    }
  }

  /** Writes text into the shell and keeps the tracked line in sync. */
  async insertText(text: string): Promise<void> {
    if (this.disposed || text.length === 0) {
      return;
    }
    this.inputLine += text;
    this.options.onInputLine?.(this.inputLine);
    await this.handleInput(text);
  }

  private handleOutput(payload: ArrayBuffer): void {
    if (this.disposed) {
      return;
    }
    this.bytesIn.value += payload.byteLength;
    this.terminal.write(new Uint8Array(payload));
  }

  private async handleInput(data: string): Promise<void> {
    if (this.disposed || this.terminalId === null) {
      return;
    }
    const bytes = this.encoder.encode(data);
    this.bytesOut += bytes.byteLength;
    try {
      await writeTerminal(this.terminalId, bytes);
    } catch (error) {
      this.options.onNotice?.(toUserMessage(error));
    }
  }

  // --------------------------------------------------------------- sizing

  private observeSize(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(this.options.container);
  }

  private scheduleFit(): void {
    if (this.disposed || !this.visible) {
      return;
    }
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
    }
    this.fitTimer = window.setTimeout(() => {
      this.fitTimer = null;
      this.fitNow();
    }, FIT_DEBOUNCE_MS);
  }

  private fitNow(): void {
    if (this.disposed) {
      return;
    }
    try {
      this.fitAddon.fit();
    } catch {
      // A zero-sized container (hidden tab) makes fit throw; the next visible
      // transition or resize will retry.
      return;
    }
    this.pushSize(false);
  }

  private pushSize(force: boolean): void {
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    if (cols < MIN_COLS || rows < MIN_ROWS) {
      return;
    }
    if (!force && cols === this.lastCols && rows === this.lastRows) {
      return;
    }
    this.lastCols = cols;
    this.lastRows = rows;
    this.options.onStatus?.({ cols, rows });

    if (this.terminalId !== null) {
      void resizeTerminal(this.terminalId, cols, rows).catch((error) => {
        this.options.onNotice?.(toUserMessage(error));
      });
    }
  }

  // ---------------------------------------------------------------- access

  get rendererKind(): RendererKind | "pending" {
    return this.renderer?.kind ?? "pending";
  }

  get stats(): { bytesIn: number; bytesOut: number } {
    return { bytesIn: this.bytesIn.value, bytesOut: this.bytesOut };
  }

  focus(): void {
    this.terminal.focus();
  }
}
