import { useEffect, useState } from "react";

import { toUserMessage } from "../lib/ipc/errors";
import { forgetKnownHost, listKnownHosts } from "../lib/ipc/sessions";
import type { KnownHostEntry } from "../lib/ipc/types";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "确认",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        <p className="modal__body">{message}</p>
        <div className="modal__actions">
          <button type="button" className="button button--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function KnownHostsDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<KnownHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listKnownHosts()
      .then(setEntries)
      .catch((err) => setError(toUserMessage(err)));
  }, []);

  async function forget(endpoint: string) {
    try {
      await forgetKnownHost(endpoint);
      setEntries(await listKnownHosts());
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">已知主机（TOFU 指纹）</h2>
        <p className="modal__hint">
          首次连接时记录的服务器指纹。删除后下次连接会重新记录，请确认服务器确实重装过。
        </p>
        {error !== null && <p className="form-error">{error}</p>}
        {entries === null ? (
          <p className="modal__body">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="modal__body">还没有记录任何主机。</p>
        ) : (
          <ul className="known-list">
            {entries.map((entry) => (
              <li key={entry.endpoint} className="known-item">
                <div>
                  <div className="known-item__endpoint">{entry.endpoint}</div>
                  <div className="known-item__fp">{entry.fingerprint}</div>
                </div>
                <button type="button" className="button button--ghost button--sm" onClick={() => forget(entry.endpoint)}>
                  忘记
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal__actions">
          <button type="button" className="button button--primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
