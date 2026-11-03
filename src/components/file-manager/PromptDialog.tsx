import { useState } from "react";

interface PromptDialogProps {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Small single-input modal used for "new folder / new file / rename". */
export function PromptDialog({
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel = "确定",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        {label !== undefined && <p className="modal__hint">{label}</p>}
        <input
          className="input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmed.length > 0) {
              onConfirm(trimmed);
            } else if (event.key === "Escape") {
              onCancel();
            }
          }}
        />
        <div className="modal__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
          >
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
