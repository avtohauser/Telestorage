import { type ReactNode, useEffect, useRef, useState } from "react";

export interface SheetAction {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ActionSheet({ title, subtitle, actions, onClose }: { title?: string; subtitle?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      {title && (
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          {subtitle && <div className="muted small">{subtitle}</div>}
        </div>
      )}
      {actions.map((a) => (
        <button
          key={a.label}
          className={`sheet-btn${a.danger ? " danger" : ""}`}
          onClick={() => {
            onClose();
            a.onClick();
          }}
        >
          <span className="sheet-icon">{a.icon}</span>
          {a.label}
        </button>
      ))}
      <button className="sheet-btn cancel" onClick={onClose}>
        Отмена
      </button>
    </Overlay>
  );
}

export function PromptSheet({ title, initial, okLabel, onSubmit, onClose }: { title: string; initial: string; okLabel: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const submit = () => {
    if (!value.trim()) return;
    onClose();
    onSubmit(value.trim());
  };
  return (
    <Overlay onClose={onClose}>
      <div className="sheet-head">
        <div className="sheet-title">{title}</div>
      </div>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} maxLength={255} />
        <button className="primary" type="submit" disabled={!value.trim()}>
          {okLabel}
        </button>
      </form>
    </Overlay>
  );
}
