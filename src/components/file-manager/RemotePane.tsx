interface RemotePaneProps {
  terminalId: string | null;
  sessionTitle: string | null;
}

/**
 * Right pane placeholder. Phase B wires it to the SFTP subsystem that is opened
 * on the *same* SSH connection as the terminal.
 */
export function RemotePane({ terminalId, sessionTitle }: RemotePaneProps) {
  return (
    <section className="fm-pane fm-pane--placeholder">
      <div className="fm-pathbar">
        <span className="fm-pathbar__label">远程</span>
        <button type="button" className="fm-iconbtn" disabled>
          ↑
        </button>
        <input className="fm-pathbar__input" value="" disabled placeholder="阶段 B 接入 SFTP" />
        <button type="button" className="fm-iconbtn" disabled>
          ⟳
        </button>
      </div>
      <div className="fm-placeholder">
        {terminalId === null ? (
          <>
            <p className="fm-placeholder__title">还没有可用的 SSH 会话</p>
            <p className="fm-placeholder__text">先回到终端连接一台服务器，远程面板会自动绑定该连接。</p>
          </>
        ) : (
          <>
            <p className="fm-placeholder__title">远程文件浏览将在阶段 B 接入</p>
            <p className="fm-placeholder__text">
              当前终端：{sessionTitle ?? "未命名"}（{terminalId}）· SFTP 会复用这条 SSH 连接
            </p>
          </>
        )}
      </div>
      <footer className="fm-pane__foot">
        <span>阶段 B</span>
      </footer>
    </section>
  );
}
