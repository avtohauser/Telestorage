import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface SheetAction {
  label: string;
  icon: IconName;
  danger?: boolean;
  onClick: () => void;
}

export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}

export function SheetHead({ title, subtitle, leading }: { title: string; subtitle?: string; leading?: ReactNode }) {
  return (
    <div className="sheet-head">
      {leading}
      <div className="sheet-head-text">
        <div className="avr-title-sm ellipsis">{title}</div>
        {subtitle && <div className="avr-body-sm avr-muted num">{subtitle}</div>}
      </div>
    </div>
  );
}

export function ActionSheet({ title, subtitle, leading, actions, onClose }: { title?: string; subtitle?: string; leading?: ReactNode; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      {title && <SheetHead title={title} subtitle={subtitle} leading={leading} />}
      <div className="sheet-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            className={`sheet-btn${a.danger ? " danger" : ""}`}
            onClick={() => {
              onClose();
              a.onClick();
            }}
          >
            <Icon name={a.icon} />
            {a.label}
          </button>
        ))}
      </div>
    </Overlay>
  );
}

export function PromptSheet({ title, initial, okLabel, placeholder, onSubmit, onClose }: { title: string; initial: string; okLabel: string; placeholder?: string; onSubmit: (v: string) => void; onClose: () => void }) {
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
        <div className="avr-title">{title}</div>
      </div>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input ref={ref} className="field" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} maxLength={255} />
        <div className="prompt-row">
          <button type="button" className="avr-btn text" onClick={onClose}>
            Отменить
          </button>
          <button className="avr-btn" type="submit" disabled={!value.trim()}>
            {okLabel}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
