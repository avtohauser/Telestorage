import { useState } from "react";
import { formatSize } from "../format";
import { clearFinished, retryTask, useUploads } from "../uploads";

export function UploadPanel() {
  const tasks = useUploads();
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;

  const active = tasks.filter((t) => t.stage !== "done" && t.stage !== "error");
  const failed = tasks.filter((t) => t.stage === "error").length;
  const total = tasks.reduce((s, t) => s + t.size, 0) || 1;
  const done = tasks.reduce((s, t) => s + (t.stage === "done" ? t.size : t.stage === "processing" ? t.size * (0.5 + t.progress / 2) : t.sent / 2), 0);

  return (
    <div className={`uploads${open ? " open" : ""}`}>
      <button className="uploads-head" onClick={() => setOpen(!open)}>
        <span>
          {active.length ? `Загрузка: ${active.length}` : failed ? `Ошибок: ${failed}` : "Все файлы загружены ✓"}
        </span>
        <span className="dim">{open ? "▾" : "▴"}</span>
        <div className="bar">
          <div style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
        </div>
      </button>
      {open && (
        <div className="uploads-list">
          {tasks.map((t) => (
            <div key={t.key} className="upload-row">
              <div className="ellipsis">{t.name}</div>
              <div className="small dim">
                {t.stage === "queued" && "В очереди"}
                {t.stage === "sending" && `На сервер: ${formatSize(t.sent)} из ${formatSize(t.size)}`}
                {t.stage === "processing" && `В Telegram: ${Math.round(t.progress * 100)}%`}
                {t.stage === "done" && "Готово"}
                {t.stage === "error" && (
                  <>
                    <span className="danger-text">{t.error}</span>{" "}
                    <button className="link" onClick={() => retryTask(t)}>
                      Повторить
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {active.length < tasks.length && (
            <button className="link pad" onClick={clearFinished}>
              Очистить завершённые
            </button>
          )}
        </div>
      )}
    </div>
  );
}
