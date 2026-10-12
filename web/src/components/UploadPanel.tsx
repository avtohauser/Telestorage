import { useState } from "react";
import { formatSize, percent, plural } from "../format";
import { clearFinished, retryTask, useUploads } from "../uploads";
import { Icon } from "./Icon";

export function UploadPanel() {
  const tasks = useUploads();
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;

  const active = tasks.filter((t) => t.stage !== "done" && t.stage !== "error");
  const failed = tasks.filter((t) => t.stage === "error").length;
  const total = tasks.reduce((s, t) => s + t.size, 0) || 1;
  // Половина пути — до сервера, вторая половина — в Telegram
  const done = tasks.reduce((s, t) => s + (t.stage === "done" ? t.size : t.stage === "processing" ? t.size * (0.5 + t.progress / 2) : t.sent / 2), 0);
  const title = active.length
    ? `Загружается ${plural(active.length, ["файл", "файла", "файлов"])}`
    : failed
      ? `Не загрузилось: ${plural(failed, ["файл", "файла", "файлов"])}`
      : "Всё загружено";

  return (
    <div className={`uploads${open ? " open" : ""}`}>
      <button className="uploads-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="avr-label">{title}</span>
        <span className="avr-body-sm avr-muted num">{active.length ? percent(done / total) : open ? "Свернуть" : "Подробнее"}</span>
        <div className="avr-wavy" data-moving={active.length ? "" : undefined} style={{ ["--v" as string]: `${Math.min(100, (done / total) * 100)}%` }} />
      </button>
      {open && (
        <div className="uploads-list">
          {tasks.map((t) => (
            <div key={t.key} className="upload-row">
              <div className="avr-body-sm ellipsis">{t.name}</div>
              <div className="avr-body-sm avr-muted num">
                {t.stage === "queued" && "В очереди"}
                {t.stage === "sending" && `На сервер · ${formatSize(t.sent)} из ${formatSize(t.size)}`}
                {t.stage === "processing" && `В Telegram · ${percent(t.progress)}`}
                {t.stage === "done" && (
                  <span className="ok-text">
                    <Icon name="check" size={16} /> Готово
                  </span>
                )}
                {t.stage === "error" && <span className="danger-text">{t.error}</span>}
              </div>
              {t.stage === "error" && (
                <button className="avr-btn text small" onClick={() => retryTask(t)}>
                  Повторить
                </button>
              )}
            </div>
          ))}
          {active.length < tasks.length && (
            <button className="avr-btn text small" onClick={clearFinished}>
              Убрать готовые
            </button>
          )}
        </div>
      )}
    </div>
  );
}
