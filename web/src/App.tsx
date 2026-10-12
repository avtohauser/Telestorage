import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Api, type FileItem, type FolderItem, type Listing, type Me } from "./api";
import { MovePicker } from "./components/MovePicker";
import { ActionSheet, PromptSheet, type SheetAction } from "./components/Sheet";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { fileIcon, formatDate, formatDuration, formatSize } from "./format";
import { alertMsg, confirmMsg, downloadUrl, haptic, tg } from "./tg";
import { addUploads, onUploadDone } from "./uploads";

type Tab = "files" | "media";
type Sheet =
  | { type: "file"; file: FileItem }
  | { type: "folder"; folder: FolderItem }
  | { type: "add" }
  | { type: "prompt"; title: string; initial: string; ok: string; submit: (v: string) => void }
  | { type: "move"; exclude?: number; pick: (id: number | null) => void }
  | null;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("files");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [media, setMedia] = useState<FileItem[] | null>(null);
  const [mediaKind, setMediaKind] = useState<"" | "image" | "video">("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FileItem[] | null>(null);
  const [viewer, setViewer] = useState<{ files: FileItem[]; index: number } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadMe = useCallback(() => Api.me().then(setMe, (e) => setFatal(errText(e))), []);
  const loadList = useCallback(() => Api.list(folderId).then(setListing, (e) => alertMsg(errText(e))), [folderId]);
  const loadMedia = useCallback(
    () => Api.search("", mediaKind).then((r) => setMedia(mediaKind ? r.files : r.files.filter((f) => f.kind === "image" || f.kind === "video"))),
    [mediaKind],
  );
  const reload = useCallback(() => {
    void loadMe();
    if (tab === "files") void loadList();
    else void loadMedia();
  }, [tab, loadList, loadMedia, loadMe]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (tab === "files") void loadList();
  }, [tab, loadList]);
  useEffect(() => {
    if (tab === "media") void loadMedia();
  }, [tab, loadMedia]);
  useEffect(() => onUploadDone(() => reload()), [reload]);

  // Поиск с небольшой задержкой
  useEffect(() => {
    if (!query.trim()) {
      setFound(null);
      return;
    }
    const t = setTimeout(() => Api.search(query.trim()).then((r) => setFound(r.files)), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Пока что-то отправляется в Telegram — обновляем список
  const pending = (listing?.files || []).some((f) => f.status === "processing");
  useEffect(() => {
    if (!pending || tab !== "files") return;
    const t = setInterval(loadList, 3000);
    return () => clearInterval(t);
  }, [pending, tab, loadList]);

  // Системная кнопка «Назад» Telegram
  const goBack = useMemo(() => {
    if (viewer) return () => setViewer(null);
    if (sheet) return () => setSheet(null);
    if (query) return () => setQuery("");
    if (tab === "files" && listing?.folder) {
      const parent = listing.path.length > 1 ? listing.path[listing.path.length - 2].id : null;
      return () => setFolderId(parent);
    }
    return null;
  }, [viewer, sheet, query, tab, listing]);
  useEffect(() => {
    if (!tg) return;
    if (!goBack) {
      tg.BackButton.hide();
      return;
    }
    tg.BackButton.show();
    tg.BackButton.onClick(goBack);
    return () => tg!.BackButton.offClick(goBack);
  }, [goBack]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) haptic("success");
      reload();
      if (found) setFound((await Api.search(query.trim())).files);
    } catch (e) {
      haptic("error");
      alertMsg(errText(e));
    }
  };

  const openFile = (list: FileItem[], file: FileItem) => {
    if (file.status === "error") {
      setSheet({ type: "file", file });
      return;
    }
    setViewer({ files: list, index: list.findIndex((f) => f.id === file.id) });
  };

  const share = async (file: FileItem) => {
    try {
      const { shareUrl } = await Api.share(file.id, true);
      if (!shareUrl) return;
      await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
      haptic("success");
      if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(file.name)}`);
      else alertMsg(`Ссылка скопирована:\n${shareUrl}`);
      reload();
    } catch (e) {
      alertMsg(errText(e));
    }
  };

  const fileActions = (file: FileItem): SheetAction[] => {
    const acts: SheetAction[] = [];
    if (file.status === "ready") {
      acts.push({ icon: "⬇️", label: "Скачать", onClick: () => downloadUrl(file.url, file.name) });
      acts.push({ icon: "🔗", label: file.shareUrl ? "Поделиться ссылкой" : "Создать публичную ссылку", onClick: () => share(file) });
      if (file.shareUrl) acts.push({ icon: "🚫", label: "Закрыть публичную ссылку", onClick: () => run(() => Api.share(file.id, false), "ok") });
    }
    if (file.status === "error") acts.push({ icon: "🔁", label: "Повторить отправку", onClick: () => run(() => Api.retryFile(file.id)) });
    acts.push({
      icon: "✏️",
      label: "Переименовать",
      onClick: () => setSheet({ type: "prompt", title: "Новое имя", initial: file.name, ok: "Сохранить", submit: (name) => run(() => Api.updateFile(file.id, { name })) }),
    });
    acts.push({
      icon: "📂",
      label: "Переместить",
      onClick: () => setSheet({ type: "move", pick: (folderId) => run(() => Api.updateFile(file.id, { folderId }), "ok") }),
    });
    acts.push({
      icon: "🗑️",
      label: "Удалить",
      danger: true,
      onClick: async () => {
        if (!(await confirmMsg(`Удалить «${file.name}»? Файл будет удалён и из Telegram.`))) return;
        setViewer(null);
        await run(() => Api.deleteFile(file.id), "ok");
      },
    });
    return acts;
  };

  const folderActions = (folder: FolderItem): SheetAction[] => [
    {
      icon: "✏️",
      label: "Переименовать",
      onClick: () => setSheet({ type: "prompt", title: "Новое имя папки", initial: folder.name, ok: "Сохранить", submit: (name) => run(() => Api.updateFolder(folder.id, { name })) }),
    },
    {
      icon: "📂",
      label: "Переместить",
      onClick: () => setSheet({ type: "move", exclude: folder.id, pick: (parentId) => run(() => Api.updateFolder(folder.id, { parentId }), "ok") }),
    },
    {
      icon: "🗑️",
      label: "Удалить папку",
      danger: true,
      onClick: async () => {
        if (!(await confirmMsg(`Удалить папку «${folder.name}» со всем содержимым?`))) return;
        await run(() => Api.deleteFolder(folder.id), "ok");
      },
    },
  ];

  if (fatal) {
    return (
      <div className="screen-center">
        <div className="big-icon">🔒</div>
        <div>{fatal}</div>
        {!tg && <div className="muted small">Это приложение работает внутри Telegram.</div>}
      </div>
    );
  }
  if (!me) return <div className="screen-center muted">Загрузка…</div>;

  const searching = found !== null;
  const files = searching ? found : tab === "files" ? (listing?.files ?? []) : (media ?? []);

  return (
    <div className="app">
      <header className="top">
        <div className="search">
          <span className="dim">🔍</span>
          <input placeholder="Поиск по файлам" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>
        {!searching && tab === "files" && (
          <nav className="crumbs">
            <button className={listing?.path.length ? "" : "current"} onClick={() => setFolderId(null)}>
              Мои файлы
            </button>
            {listing?.path.map((p, i) => (
              <span key={p.id}>
                <span className="dim">{"\u00a0/\u00a0"}</span>
                <button className={i === listing.path.length - 1 ? "current" : ""} onClick={() => setFolderId(p.id)}>
                  {p.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        {!searching && tab === "media" && (
          <div className="chips">
            {(
              [
                ["", "Всё"],
                ["image", "Фото"],
                ["video", "Видео"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={mediaKind === k ? "chip on" : "chip"} onClick={() => setMediaKind(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {searching && <div className="muted small pad-x">Найдено: {found.length}</div>}
      </header>

      {!me.storageReady && <div className="warn">Хранилище не настроено: администратору нужно указать STORAGE_CHANNEL_ID.</div>}

      <main>
        {tab === "media" && !searching ? (
          <MediaGrid files={files} onOpen={(f) => openFile(files, f)} />
        ) : (
          <div className="list">
            {!searching &&
              listing?.folders.map((f) => (
                <div key={`d${f.id}`} className="row" onClick={() => setFolderId(f.id)}>
                  <div className="thumb folder">📁</div>
                  <div className="row-main">
                    <div className="ellipsis">{f.name}</div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSheet({ type: "folder", folder: f });
                    }}
                  >
                    ⋯
                  </button>
                </div>
              ))}
            {files.map((f) => (
              <FileRow key={f.id} file={f} onOpen={() => openFile(files, f)} onMore={() => setSheet({ type: "file", file: f })} />
            ))}
            {!searching && listing && !listing.folders.length && !listing.files.length && (
              <div className="empty">
                <div className="big-icon">☁️</div>
                <div>Здесь пока пусто</div>
                <div className="muted small">Нажмите «+», чтобы загрузить файлы, или пришлите их боту в чат</div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="bottom">
        <UploadPanel />
        <div className="tabs">
          <button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>
            <span>🗂️</span>Файлы
          </button>
          <button className="fab" onClick={() => setSheet({ type: "add" })} aria-label="Добавить">
            +
          </button>
          <button className={tab === "media" ? "on" : ""} onClick={() => setTab("media")}>
            <span>🖼️</span>Медиа
          </button>
        </div>
        <div className="usage small dim">
          {me.stats.count} файлов · {formatSize(me.stats.size)}
        </div>
      </footer>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            addUploads(e.target.files, tab === "files" ? folderId : null);
            haptic("light");
          }
          e.target.value = "";
        }}
      />

      {viewer && (
        <Viewer
          files={viewer.files}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          onMore={(file) => setSheet({ type: "file", file })}
          onDownload={(f) => downloadUrl(f.url, f.name)}
        />
      )}

      {sheet?.type === "add" && (
        <ActionSheet
          actions={[
            { icon: "⬆️", label: "Загрузить файлы", onClick: () => fileInput.current?.click() },
            {
              icon: "📁",
              label: "Новая папка",
              onClick: () =>
                setSheet({
                  type: "prompt",
                  title: "Название папки",
                  initial: "",
                  ok: "Создать",
                  submit: (name) => run(() => Api.createFolder(name, tab === "files" ? folderId : null)),
                }),
            },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "file" && (
        <ActionSheet
          title={sheet.file.name}
          subtitle={`${formatSize(sheet.file.size)} · ${formatDate(sheet.file.createdAt)}`}
          actions={fileActions(sheet.file)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "folder" && <ActionSheet title={sheet.folder.name} actions={folderActions(sheet.folder)} onClose={() => setSheet(null)} />}
      {sheet?.type === "prompt" && <PromptSheet title={sheet.title} initial={sheet.initial} okLabel={sheet.ok} onSubmit={sheet.submit} onClose={() => setSheet(null)} />}
      {sheet?.type === "move" && <MovePicker exclude={sheet.exclude} onPick={sheet.pick} onClose={() => setSheet(null)} />}
    </div>
  );
}

function Thumb({ file }: { file: FileItem }) {
  const [broken, setBroken] = useState(false);
  if (file.thumbUrl && !broken) return <img className="thumb" src={file.thumbUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return <div className="thumb">{fileIcon(file.kind, file.name)}</div>;
}

function FileRow({ file, onOpen, onMore }: { file: FileItem; onOpen: () => void; onMore: () => void }) {
  return (
    <div className="row" onClick={onOpen}>
      <Thumb file={file} />
      <div className="row-main">
        <div className="ellipsis">{file.name}</div>
        <div className="small dim">
          {file.status === "processing" ? (
            <>Отправка в Telegram… {Math.round(file.progress * 100)}%</>
          ) : file.status === "error" ? (
            <span className="danger-text">Ошибка: {file.error}</span>
          ) : (
            <>
              {formatSize(file.size)}
              {file.duration ? ` · ${formatDuration(file.duration)}` : ""} · {formatDate(file.createdAt)}
              {file.shareUrl ? " · 🔗" : ""}
            </>
          )}
        </div>
      </div>
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          onMore();
        }}
      >
        ⋯
      </button>
    </div>
  );
}

function MediaGrid({ files, onOpen }: { files: FileItem[]; onOpen: (f: FileItem) => void }) {
  if (!files.length)
    return (
      <div className="empty">
        <div className="big-icon">🖼️</div>
        <div>Фото и видео пока нет</div>
      </div>
    );
  return (
    <div className="grid">
      {files.map((f) => (
        <button key={f.id} className="cell" onClick={() => onOpen(f)}>
          <Thumb file={f} />
          {f.kind === "video" && <span className="badge">▶ {formatDuration(f.duration)}</span>}
        </button>
      ))}
    </div>
  );
}
