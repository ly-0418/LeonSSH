import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

/**
 * Window controls for the frameless window: minimize / maximize-restore / close.
 * The window is created with `decorations(false)`, so these replace the
 * system caption buttons.
 */
export function WindowControls({ onClose }: { onClose?: () => void }) {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) {
          setMaximized(value);
        }
      });
    };

    sync();
    void appWindow
      .onResized(() => sync())
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-controls__btn window-controls__btn--min"
        title="最小化"
        aria-label="最小化"
        onClick={() => void appWindow.minimize()}
      >
        ─
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--max"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {maximized ? "❐" : "□"}
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--close"
        title="关闭"
        aria-label="关闭"
          onClick={() => {
            if (onClose !== undefined) {
              onClose();
              return;
            }
            void invoke("frontend_error", { message: "close-clicked" });
            appWindow.close().catch((error: unknown) =>
              void invoke("frontend_error", { message: `close-failed: ${String(error)}` }),
            );
          }}
      >
        ✕
      </button>
    </div>
  );
}
