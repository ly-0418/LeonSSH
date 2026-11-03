import { useEffect, useRef, useState } from "react";

import { toUserMessage } from "../lib/ipc/errors";
import { createSession, setSessionPassword, updateSession } from "../lib/ipc/sessions";
import type { SessionInput, SessionSummary } from "../lib/ipc/types";

interface SessionFormProps {
  /** Present when editing an existing profile. */
  initial?: SessionSummary | null;
  /** First run: the form is shown inline instead of a modal. */
  onboarding?: boolean;
  onSaved: (session: SessionSummary) => void;
  onCancel?: () => void;
}

export function SessionForm({ initial, onboarding = false, onSaved, onCancel }: SessionFormProps) {
  const [name, setName] = useState(initial?.name ?? (onboarding ? "本地 Docker 测试" : ""));
  const [host, setHost] = useState(initial?.host ?? "127.0.0.1");
  const [port, setPort] = useState(String(initial?.port ?? 2222));
  const [username, setUsername] = useState(initial?.username ?? "test");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const portNumber = Number.parseInt(port, 10);
    if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError("端口必须是 1-65535 之间的数字");
      return;
    }

    const input: SessionInput = {
      name: name.trim(),
      host: host.trim(),
      port: portNumber,
      username: username.trim(),
      authMethod: "password",
    };

    setBusy(true);
    setError(null);
    try {
      const saved = initial
        ? await updateSession(initial.id, input)
        : await createSession(input);

      // The password goes to the Credential Manager via its own command; it is
      // never part of the SQLite row payload.
      if (password.length > 0) {
        await setSessionPassword(saved.id, password);
      }

      onSaved({ ...saved, hasPassword: saved.hasPassword || password.length > 0 });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`session-form${onboarding ? " session-form--onboarding" : ""}`} onSubmit={handleSubmit}>
      <header className="session-form__head">
        <h2>{initial ? "编辑会话" : "新建会话"}</h2>
        {onboarding && <p>填写连接信息，密码会保存到 Windows 凭据管理器。</p>}
      </header>

      <label className="field">
        <span className="field__label">名称</span>
        <input
          ref={nameRef}
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：生产环境"
          autoComplete="off"
        />
      </label>

      <div className="field-row">
        <label className="field field--grow">
          <span className="field__label">主机</span>
          <input
            className="input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="192.168.1.10"
            autoComplete="off"
          />
        </label>
        <label className="field field--port">
          <span className="field__label">端口</span>
          <input
            className="input"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            inputMode="numeric"
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field field--grow">
          <span className="field__label">用户名</span>
          <input
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">密码</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={initial?.hasPassword ? "已保存，留空则不修改" : "保存到凭据管理器"}
            autoComplete="new-password"
          />
        </label>
      </div>

      {error !== null && <p className="form-error">{error}</p>}

      <div className="session-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? "保存中…" : initial ? "保存并连接" : "创建并连接"}
        </button>
        {onCancel && (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </form>
  );
}
