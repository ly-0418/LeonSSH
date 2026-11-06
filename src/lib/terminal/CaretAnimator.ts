/** Custom caret with smooth blink / smooth movement for xterm.
 *
 * Why an overlay instead of xterm's cursor?
 * ---------------------------------------------------------------
 * xterm.js paints its cursor inside the same canvas it uses for text. With the
 * WebGL addon that canvas is a GPU texture, so:
 *   - `cursorStyle`/`cursorBlink` changes force a full texture redraw;
 *   - the cursor cannot be animated (no per-frame alpha / position control);
 *   - `cursorInactiveStyle` swaps the glyph entirely when focus is lost.
 *
 * So while either animation is enabled we hide the native cursor (a transparent
 * cursor colour) and draw a DOM caret above the canvas. The DOM caret is
 * composited by the browser, never touches the text texture, and is animated by
 * a single requestAnimationFrame loop.
 *
 * Logical vs visual cursor
 * ---------------------------------------------------------------
 * The *logical* cursor (buffer.cursorX/cursorY) is always updated instantly by
 * xterm — input, pty data and parsing never see this class. Only the *visual*
 * position (pixel coordinates kept here) is interpolated, so typing latency is
 * unchanged and the caret can never desynchronise the buffer.
 *
 * DOM renderer: the same overlay works, it simply sits above the DOM row
 * elements instead of a canvas. No extra handling is needed.
 */

import type { Terminal } from "@xterm/xterm";

import {
  easeOutCubic,
  linear,
  type CursorConfig,
  type SmoothMoveMode,
} from "./cursor";

interface CaretAnimatorOptions {
  terminal: Terminal;
  /** The `.xterm` element; the overlay is positioned inside it. */
  container: HTMLElement;
  /** Reads the current configuration (kept live so settings apply instantly). */
  getConfig: () => CursorConfig;
  /** Caret colour, e.g. the terminal theme's cursor colour. */
  getColor: () => string;
}

const BLINK_PERIOD_MS = 1100;
const MOVE_DURATION: Record<Exclude<SmoothMoveMode, "off">, number> = {
  snappy: 90,
  gliding: 170,
};

interface Metrics {
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
}

export class CaretAnimator {
  private readonly element: HTMLDivElement;
  private readonly disposers: Array<() => void> = [];
  private frame = 0;
  private attached = false;
  /** Visual (animated) caret position in pixels, relative to the container. */
  private visualX = 0;
  private visualY = 0;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private moveStart = 0;
  private moveDuration = 0;
  private moving = false;
  private lastMetrics: Metrics | null = null;

  constructor(private readonly options: CaretAnimatorOptions) {
    this.element = document.createElement("div");
    this.element.className = "xterm-caret-overlay";
    this.element.setAttribute("aria-hidden", "true");
    options.container.appendChild(this.element);
    this.attach();
    this.updateConfig();
  }

  /** Enables/disables the native cursor and restarts the render loop. */
  updateConfig(): void {
    const config = this.options.getConfig();
    if (!this.attached) {
      return;
    }
    const active = config.smoothBlink || config.smoothMove !== "off";
    this.element.style.display = active ? "block" : "none";
    if (!active) {
      this.stop();
      return;
    }
    this.applyShape(config);
    // A jump-mode change while moving should settle immediately.
    if (config.smoothMove === "off") {
      this.snapToTarget();
    }
    this.start();
  }

  /** Caret colour changed (theme switch). */
  setColor(): void {
    const config = this.options.getConfig();
    this.applyShape(config);
  }

  dispose(): void {
    this.stop();
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.element.remove();
    this.attached = false;
  }

  private attach(): void {
    const { terminal, container } = this.options;
    this.attached = true;

    // xterm fires onCursorMove for every logical cursor change; we only start a
    // visual animation here and never block the event.
    const cursorListener = terminal.onCursorMove(() => {
      this.scheduleMove();
    });
    this.disposers.push(() => cursorListener.dispose());

    const resizeListener = terminal.onResize(() => {
      this.lastMetrics = null;
      this.snapToTarget();
    });
    this.disposers.push(() => resizeListener.dispose());

    const observer = new ResizeObserver(() => {
      // The container can be laid out after the terminal opens: re-measure and
      // refresh the caret size before snapping to the new grid.
      this.lastMetrics = null;
      this.snapToTarget();
      this.updateConfig();
    });
    observer.observe(container);
    this.disposers.push(() => observer.disconnect());

    // Blinking must not burn CPU while the window is hidden.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        this.start();
      } else {
        this.stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));

    this.lastMetrics = this.measure();
    this.snapToTarget();
  }

  private applyShape(config: CursorConfig): void {
    let metrics = this.lastMetrics;
    if (metrics === null || metrics.cellWidth < 1 || metrics.cellHeight < 1) {
      metrics = this.measure();
      this.lastMetrics = metrics;
    }
    if (metrics.cellWidth < 1 || metrics.cellHeight < 1) {
      // The terminal may still be laid out after `open()`; retry next frame so
      // the overlay never stays at zero size.
      window.requestAnimationFrame(() => {
        if (!this.attached) {
          return;
        }
        this.lastMetrics = this.measure();
        this.applyShape(this.options.getConfig());
        this.snapToTarget();
      });
    }
    const color = this.options.getColor();
    if (config.shape === "underline") {
      this.element.style.width = `${metrics.cellWidth}px`;
      this.element.style.height = "2px";
      this.element.style.borderRadius = "0";
      this.element.style.background = color;
      this.element.style.transformOrigin = "left top";
    } else {
      const width = Math.max(1, Math.min(6, config.width));
      this.element.style.width = `${width}px`;
      this.element.style.height = `${metrics.cellHeight}px`;
      this.element.style.borderRadius = `${Math.max(0, Math.min(config.blinkRadius, 8))}px`;
      this.element.style.background = color;
    }
    this.element.style.opacity = "1";
  }

  /** Cell size and canvas offset, preferring xterm's renderer dimensions. */
  private measure(): Metrics {
    const { terminal, container } = this.options;
    // `_core.renderer.dimensions` is the only place xterm exposes the real
    // (fractional) cell size; both the DOM and WebGL renderers implement it.
    const core = (terminal as unknown as {
      _core?: {
        renderer?: {
          dimensions?: { cellWidth: number; cellHeight: number };
          getCanvas?: () => { width: number; height: number } | null;
        };
      };
    })._core;
    const dimensions = core?.renderer?.dimensions;
    const screen = container.querySelector<HTMLElement>(".xterm-screen");
    const screenRect = screen?.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let cellWidth = dimensions?.cellWidth ?? 0;
    let cellHeight = dimensions?.cellHeight ?? 0;
    if (!cellWidth || !cellHeight) {
      const cols = Math.max(1, terminal.cols);
      const rows = Math.max(1, terminal.rows);
      cellWidth = (screenRect?.width ?? containerRect.width) / cols;
      cellHeight = (screenRect?.height ?? containerRect.height) / rows;
    }
    return {
      cellWidth,
      cellHeight,
      offsetX: (screenRect?.left ?? containerRect.left) - containerRect.left,
      offsetY: (screenRect?.top ?? containerRect.top) - containerRect.top,
    };
  }

  private target(): { x: number; y: number } {
    const metrics = this.lastMetrics ?? this.measure();
    this.lastMetrics = metrics;
    const buffer = this.options.terminal.buffer.active;
    // Logical cursor: the buffer's own column/row (never touched by us).
    return {
      x: metrics.offsetX + buffer.cursorX * metrics.cellWidth,
      y: metrics.offsetY + buffer.cursorY * metrics.cellHeight,
    };
  }

  private snapToTarget(): void {
    const target = this.target();
    this.visualX = target.x;
    this.visualY = target.y;
    this.moving = false;
    this.renderPosition();
  }

  private scheduleMove(): void {
    const config = this.options.getConfig();
    if (config.smoothMove === "off") {
      this.snapToTarget();
      return;
    }
    const target = this.target();
    const metrics = this.lastMetrics ?? this.measure();
    this.lastMetrics = metrics;

    // Interrupt the previous animation: the new target wins immediately.
    this.fromX = this.visualX;
    this.fromY = this.visualY;
    this.toX = target.x;
    this.toY = target.y;
    const distance = Math.hypot(this.toX - this.fromX, this.toY - this.fromY);
    if (distance < 1) {
      this.visualX = this.toX;
      this.visualY = this.toY;
      this.renderPosition();
      return;
    }
    this.moveDuration = MOVE_DURATION[config.smoothMove];
    this.moveStart = performance.now();
    this.moving = true;
    this.start();
  }

  private positionTransform(): string {
    return `translate3d(${this.visualX}px, ${this.visualY}px, 0)`;
  }

  private renderPosition(): void {
    this.element.style.transform = this.positionTransform();
  }

  private start(): void {
    if (this.frame !== 0) {
      return;
    }
    const loop = () => {
      this.frame = window.requestAnimationFrame(loop);
      const config = this.options.getConfig();
      if (!config.smoothBlink && config.smoothMove === "off") {
        return;
      }
      const now = performance.now();

      if (this.moving) {
        const elapsed = now - this.moveStart;
        const progress = Math.min(1, elapsed / this.moveDuration);
        const eased = config.smoothMove === "gliding" ? linear(progress) : easeOutCubic(progress);
        this.visualX = this.fromX + (this.toX - this.fromX) * eased;
        this.visualY = this.fromY + (this.toY - this.fromY) * eased;
        if (progress >= 1) {
          this.moving = false;
        }
        this.renderPosition();
      }

      if (config.smoothBlink) {
        // Smooth fade: sine wave mapped to alpha, never fully invisible so the
        // caret stays discoverable (matches IDEA's smooth caret).
        const phase = (now % BLINK_PERIOD_MS) / BLINK_PERIOD_MS;
        const wave = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
        const opacity = 0.18 + 0.82 * wave * wave;
        this.element.style.opacity = opacity.toFixed(3);
      } else {
        this.element.style.opacity = "1";
      }
    };
    this.frame = window.requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.frame !== 0) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.moving = false;
  }
}
