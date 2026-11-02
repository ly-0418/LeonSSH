/** Renderer selection and graceful degradation.
 *
 * Requirement: use the WebGL renderer when WebGL2 is available, otherwise fall
 * back to the DOM renderer; and if the GPU context is lost *while running*,
 * fall back to DOM without losing the scrollback buffer.
 *
 * That last part is free because xterm keeps the terminal model (buffer, rows,
 * scrollback) completely separate from the renderer — disposing the addon only
 * swaps how those rows are painted.
 */

import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

import type { RendererKind } from "../ipc/types";

export interface RendererController {
  readonly kind: RendererKind;
  dispose(): void;
}

export function isWebgl2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (!context) {
      return false;
    }
    // Release the probe context immediately; WebView2 has a limited budget of
    // live GPU contexts and the real terminal needs one.
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function installRenderer(
  terminal: Terminal,
  onKindChange: (kind: RendererKind, reason: string) => void,
): RendererController {
  let kind: RendererKind = "dom";
  let addon: WebglAddon | null = null;

  if (!isWebgl2Available()) {
    onKindChange("dom", "webgl2-unavailable");
    return {
      get kind() {
        return kind;
      },
      dispose() {
        /* nothing to release */
      },
    };
  }

  try {
    addon = new WebglAddon();
    addon.onContextLoss(() => {
      kind = "dom";
      try {
        addon?.dispose();
      } catch {
        // The context is already gone; disposing twice is harmless.
      }
      addon = null;
      onKindChange("dom", "webgl-context-lost");
    });
    terminal.loadAddon(addon);
    kind = "webgl";
    onKindChange("webgl", "webgl2-available");
  } catch (error) {
    try {
      addon?.dispose();
    } catch {
      // ignore
    }
    addon = null;
    kind = "dom";
    onKindChange("dom", `webgl-init-failed: ${String(error)}`);
  }

  return {
    get kind() {
      return kind;
    },
    dispose() {
      try {
        addon?.dispose();
      } catch {
        // ignore
      }
      addon = null;
    },
  };
}
