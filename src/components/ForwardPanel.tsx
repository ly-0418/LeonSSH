import { useCallback, useEffect, useState } from "react";

import { toUserMessage } from "../lib/ipc/errors";
import {
  createForward,
  deleteForward,
  listForwards,
  startForward,
  stopForward,
  type ForwardView,
} from "../lib/ipc/forwards";

interface ForwardPanelProps {
  terminalId: string;
  sessionId: number;
  title: string;
}

const KIND_LABEL: Record<string, string> = {
  local: "-L 本地",
  remote: "-R 远程",
  dynamic: "-D SOCKS5",
};

export function ForwardPanel({ terminalId, sessionId, title }: ForwardPanelProps) {
  const [rules, setRules] = useState<ForwardView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState("local");
  const [bindPort, setBindPort] = useState("8080");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("80");

  const refresh = useCallback(async () => {
    try {
      setRules(await listForwards(sessionId));
    } catch (err) {
      setError(toUserMessage(err));
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addRule() {
    const port = Number.parseInt(bindPort, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      setError("监听端口必须是 1-65535");
      return;
    }
    const needsTarget = kind !== "dynamic";
    const targetPortNumber = Number.parseInt(targetPort, 10);
    if (needsTarget && (!targetHost.trim() || !Number.isFinite(targetPortNumber))) {
      setError("目标主机/端口不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createForward({
        sessionId,
        kind,
        bindHost: "127.0.0.1",
        bindPort: port,
        targetHost: needsTarget ? targetHost.trim() : null,
        targetPort: needsTarget ? targetPortNumber : null,
      });
      await refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: ForwardView) {
    setBusy(true);
    setError(null);
    try {
      if (rule.running) {
        await stopForward(rule.id);
      } else {
        await startForward(terminalId, rule.id);
      }
      await refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: ForwardView) {
    setBusy(true);
    try {
      await deleteForward(rule.id);
      await refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sftp">
      <header className="sftp__head">
        <span className="sftp__title">端口转发 · {title}</span>
        <span className="sftp__hint">复用当前 SSH 连接；终端关闭时自动回收</span>
      </header>

      <div className="forward__body">
        <div className="forward__form">
          <div className="forward__row">
            <select className="input forward__kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="local">-L 本地转发</option>
              <option value="remote">-R 远程转发</option>
              <option value="dynamic">-D 动态 SOCKS5</option>
            </select>
            <button
              type="button"
              className="button button--primary button--sm forward__add"
              disabled={busy}
              onClick={() => void addRule()}
            >
              添加规则
            </button>
          </div>
          <div className="forward__row">
            <span className="forward__label">本地端口</span>
            <input
              className="input forward__port"
              type="number"
              min={1}
              max={65535}
              step={1}
              value={bindPort}
              onChange={(e) => setBindPort(e.target.value)}
            />
            {kind !== "dynamic" && (
              <>
                <span className="forward__label forward__label--target">目标</span>
                <input
                  className="input forward__host"
                  value={targetHost}
                  onChange={(e) => setTargetHost(e.target.value)}
                  placeholder="host"
                />
                <span className="forward__colon">:</span>
                <input
                  className="input forward__port"
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        {error !== null && <p className="form-error">{error}</p>}

        <ul className="forward__list">
          {rules.length === 0 && <li className="forward__empty">还没有转发规则。</li>}
          {rules.map((rule) => (
            <li key={rule.id} className="forward__item">
              <span className={`forward__dot${rule.running ? " forward__dot--on" : ""}`} />
              <span className="forward__kindlabel">{KIND_LABEL[rule.kind] ?? rule.kind}</span>
              <span className="forward__route">
                {rule.bindHost}:{rule.bindPort}
                {rule.kind !== "dynamic" ? ` → ${rule.targetHost}:${rule.targetPort}` : " → SOCKS5"}
              </span>
              <button
                type="button"
                className="button button--sm"
                disabled={busy}
                onClick={() => void toggle(rule)}
              >
                {rule.running ? "停止" : "启动"}
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={busy}
                onClick={() => void remove(rule)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>

        <p className="forward__note">
          示例：`-L 8080 → 127.0.0.1:80` 之后，访问本机 `http://127.0.0.1:8080` 就相当于访问远端的 80 端口。
          `-D` 规则可作为浏览器/工具的 SOCKS5 代理（无认证）。
        </p>
      </div>
    </div>
  );
}
