import { useEffect, useRef, useState } from "react";

import { toUserMessage } from "../lib/ipc/errors";
import { createSession, setSessionPassword, updateSession } from "../lib/ipc/sessions";
import { testConnection } from "../lib/ipc/sessions";
import type { SessionInput, SessionSummary } from "../lib/ipc/types";

interface SessionFormProps {
  /** Present when editing an existing profile. */
  initial?: SessionSummary | null;
  /** First run: the form is shown inline instead of a modal. */
  onboarding?: boolean;
  /** Save without connecting. */
  onSaved: (session: SessionSummary) => void;
  /** Save and connect right away. */
  onSavedAndConnect: (session: SessionSummary) => void;
}

const DEFAULT_PORT = 22;

export function SessionForm({
  initial,
  onboarding = false,
  onSaved,
  onSavedAndConnect,
}: SessionFormProps) {
  const [name, setName] = useState(initial?.name ?? (onboarding ? "本地 Docker 测试" : ""));
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_PORT));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"password" | "key">(
    initial?.authMethod === "key" ? "key" : "password",
  );
  const [keyPath, setKeyPath] = useState(initial?.privateKeyPath ?? "");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  async function handleTest() {
    const portNumber = Number.parseInt(port, 10);
    if (host.trim().length === 0) {
      setTestResult({ ok: false, text: "请先填写主机地址" });
      return;
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setTestResult({ ok: false, text: "端口必须是 1-65535 的整数" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const millis = await testConnection(host.trim(), portNumber);
      setTestResult({ ok: true, text: `可达，${millis} ms` });
    } catch (err) {
      setTestResult({ ok: false, text: toUserMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  async function submit(connect: boolean) {
    if (busy) {
      return;
    }
    const portNumber = Number.parseInt(port, 10);
    if (host.trim().length === 0) {
      setError("主机地址不能为空");
      return;
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError("端口必须是 1-65535 之间的整数");
      return;
    }
    if (username.trim().length === 0) {
      setError("用户名不能为空");
      return;
    }
    if (authMode === "key" && keyPath.trim().length === 0) {
      setError("请选择私钥文件");
      return;
    }

    const input: SessionInput = {
      name: name.trim().length > 0 ? name.trim() : host.trim(),
      host: host.trim(),
      port: portNumber,
      username: username.trim(),
      authMethod: authMode,
      privateKeyPath: authMode === "key" ? keyPath.trim() : null,
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

      const view = { ...saved, hasPassword: saved.hasPassword || password.length > 0 };
      if (connect) {
        onSavedAndConnect(view);
      } else {
        onSaved(view);
      }
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`session-form${onboarding ? " session-form--onboarding" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
    >
      <div className="form-row">
        <label className="form-row__label" htmlFor="session-name">
          名称
        </label>
        <input
          id="session-name"
          ref={nameRef}
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="留空则使用地址"
        />
      </div>

      <div className="form-row">
        <label className="form-row__label" htmlFor="session-host">
          地址
        </label>
        <div className="form-row__address">
          <input
            id="session-host"
            className="input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="主机名或 IP"
            spellCheck={false}
          />
          <span className="form-row__colon">:</span>
          <input
            id="session-port"
            className="input form-row__port"
            type="number"
            min={1}
            max={65535}
            step={1}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            aria-label="端口"
          />
        </div>
      </div>

      <div className="form-row">
        <span className="form-row__label">认证</span>
        <div className="auth-switch">
          <button
            type="button"
            className={`auth-switch__btn${authMode === "password" ? " auth-switch__btn--active" : ""}`}
            onClick={() => setAuthMode("password")}
          >
            密码
          </button>
          <button
            type="button"
            className={`auth-switch__btn${authMode === "key" ? " auth-switch__btn--active" : ""}`}
            onClick={() => setAuthMode("key")}
          >
            密钥文件
          </button>
        </div>
      </div>

      {authMode === "key" && (
        <div className="form-row">
          <span className="form-row__label">私钥</span>
          <div className="form-row__address">
            <input
              className="input"
              value={keyPath}
              onChange={(event) => setKeyPath(event.target.value)}
              placeholder="C:\Users\你\.ssh\id_ed25519"
              spellCheck={false}
            />

          </div>
        </div>
      )}

      <div className="form-row">
        <label className="form-row__label" htmlFor="session-user">
          用户名
        </label>
        <input
          id="session-user"
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="form-row">
        <label className="form-row__label" htmlFor="session-password">
          {authMode === "key" ? "密钥口令" : "密码"}
        </label>
        <span className="field__with-action">
          <input
            id="session-password"
            className="input"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={authMode === "key" ? "私钥有口令时填写（可选）" : initial?.hasPassword ? "已保存，留空则不修改" : "保存到凭据管理器"}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="field__action"
            title={showPassword ? "隐藏密码" : "显示密码"}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            tabIndex={-1}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? "🙈" : "👁"}
          </button>
        </span>
      </div>

      {error !== null && <p className="form-error">{error}</p>}
      {testResult !== null && (
        <p className={`form-test${testResult.ok ? " form-test--ok" : " form-test--bad"}`}>
          {testResult.ok ? "连通性正常：" : "连通性失败："}
          {testResult.text}
        </p>
      )}

      <div className="session-form__actions">
        <button
          type="button"
          className="button button--ghost"
          disabled={testing || busy}
          onClick={() => void handleTest()}
        >
          {testing ? "测试中…" : "测连通性"}
        </button>
        <span className="session-form__spacer" />

        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          保存
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? "处理中…" : "连接"}
        </button>
      </div>
    </form>
  );
}
