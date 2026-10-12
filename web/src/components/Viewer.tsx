import { useEffect, useRef } from "react";
import type { FileItem } from "../api";
import { Loader } from "../brand";
import { formatSize } from "../format";
import { fileIconName, Icon } from "./Icon";

export function Viewer({ files, index, onIndex, onClose, onMore, onDownload }: {
  files: FileItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onMore: (f: FileItem) => void;
  onDownload: (f: FileItem) => void;
}) {
  const file = files[index];
  const touch = useRef<{ x: number; y: number } | null>(null);
  const prev = index > 0 ? () => onIndex(index - 1) : undefined;
  const next = index < files.length - 1 ? () => onIndex(index + 1) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev?.();
      if (e.key === "ArrowRight") next?.();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!file) return null;
  const ready = file.status === "ready";

  return (
    <div
      className="viewer"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        if (!touch.current || file.kind === "video") return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        touch.current = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) (dx > 0 ? prev : next)?.();
        else if (dy > 100) onClose();
      }}
    >
      <div className="viewer-top">
        <button className="round-btn" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
        <div className="viewer-title">
          <div className="avr-title-sm ellipsis">{file.name}</div>
          <div className="avr-body-sm dim num">
            {formatSize(file.size)} · {index + 1} из {files.length}
          </div>
        </div>
        <button className="round-btn" onClick={() => onMore(file)} aria-label="Действия">
          <Icon name="more" />
        </button>
      </div>

      <div className="viewer-body" key={file.id}>
        {!ready ? (
          <div className="viewer-doc">
            <Loader />
            <div className="avr-body">Файл ещё отправляется в Telegram — откроется, как только будет готов.</div>
          </div>
        ) : file.kind === "image" ? (
          <img className="appear" src={file.url} alt={file.name} />
        ) : file.kind === "video" ? (
          <video src={file.url} controls autoPlay playsInline poster={file.thumbUrl || undefined} />
        ) : file.kind === "audio" ? (
          <div className="viewer-doc">
            <div className="doc-tile">
              <Icon name="audio" size={40} />
            </div>
            <audio src={file.url} controls autoPlay />
          </div>
        ) : (
          <div className="viewer-doc">
            <div className="doc-tile">
              <Icon name={fileIconName(file.kind, file.name)} size={40} />
            </div>
            <div className="avr-title-sm ellipsis" style={{ maxWidth: "80vw" }}>
              {file.name}
            </div>
            <div className="avr-body-sm dim num">{formatSize(file.size)}</div>
            <button className="avr-btn" onClick={() => onDownload(file)}>
              <Icon name="download" />
              Скачать
            </button>
          </div>
        )}
        {prev && (
          <button className="nav-btn left" onClick={prev} aria-label="Предыдущий">
            <Icon name="chevronLeft" />
          </button>
        )}
        {next && (
          <button className="nav-btn right" onClick={next} aria-label="Следующий">
            <Icon name="chevronRight" />
          </button>
        )}
      </div>
    </div>
  );
}
