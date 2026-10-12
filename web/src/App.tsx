import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Api, ApiError, type FileItem, type FolderItem, type Listing, type Me } from "./api";
import { Loader, Sign, Star, useStarfield, Wordmark } from "./brand";
import { fileIconName, Icon } from "./components/Icon";
import { MovePicker } from "./components/MovePicker";
import { ActionSheet, PromptSheet, type SheetAction } from "./components/Sheet";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { formatDate, formatDuration, formatSize, percent, plural } from "./format";
import { alertMsg, confirmMsg, downloadUrl, haptic, tg } from "./tg";
import { addUploads, onUploadDone, useUploads } from "./uploads";

type Tab = "files" | "media";
type Sheet =
  | { type: "file"; file: FileItem }
  | { type: "folder"; folder: FolderItem }
  | { type: "add" }
  | { type: "prompt"; title: string; initial: string; ok: string; placeholder?: string; submit: (v: string) => void }
  | { type: "move"; exclude?: number; pick: (id: number | null) => void }
  | null;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [fatal, setFatal] = useState<{ text: string; status?: number } | null>(null);
  const [tab, setTab] = useState<Tab>("files");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [media, setMedia] = useState<FileItem[] | null>(null);
  const [mediaKind, setMediaKind] = useState<"" | "image" | "video">("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FileItem[] | null>(null);
  const [viewer, setViewer] = useState<{ files: FileItem[]; index: number } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fresh, setFresh] = useState<number[]>([]); // только что загруженные — мерцают звездой (не больше трёх)
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useUploads();
  const uploading = uploads.some((t) => t.stage !== "done" && t.stage !== "error");

  const loadMe = useCallback(
    () => Api.me().then(setMe, (e) => setFatal({ text: errText(e), status: e instanceof ApiError ? e.status : undefined })),
    [],
  );
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
  useEffect(
    () =>
      onUploadDone((t) => {
        if (t.fileId) setFresh((f) => [t.fileId!, ...f].slice(0, 3));
        reload();
      }),
    [reload],
  );

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

  const run = async (fn: () => Promise<unknown>, ok?: boolean) => {
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

  const pickFiles = () => fileInput.current?.click();

  const share = async (file: FileItem) => {
    try {
      const { shareUrl } = await Api.share(file.id, true);
      if (!shareUrl) return;
      await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
      haptic("success");
      if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(file.name)}`);
      else alertMsg(`Ссылка скопирована: ${shareUrl}`);
      reload();
    } catch (e) {
      alertMsg(errText(e));
    }
  };

  const fileActions = (file: FileItem): SheetAction[] => {
    const acts: SheetAction[] = [];
    if (file.status === "ready") {
      acts.push({ icon: "download", label: "Скачать", onClick: () => downloadUrl(file.url, file.name) });
      acts.push({ icon: "link", label: file.shareUrl ? "Поделиться ссылкой" : "Создать ссылку", onClick: () => share(file) });
      if (file.shareUrl) acts.push({ icon: "unlink", label: "Закрыть доступ по ссылке", onClick: () => run(() => Api.share(file.id, false), true) });
    }
    if (file.status === "error") acts.push({ icon: "retry", label: "Отправить ещё раз", onClick: () => run(() => Api.retryFile(file.id)) });
    acts.push({
      icon: "edit",
      label: "Переименовать",
      onClick: () => setSheet({ type: "prompt", title: "Переименовать", initial: file.name, ok: "Сохранить", submit: (name) => run(() => Api.updateFile(file.id, { name })) }),
    });
    acts.push({ icon: "folderMove", label: "Переместить", onClick: () => setSheet({ type: "move", pick: (folderId) => run(() => Api.updateFile(file.id, { folderId }), true) }) });
    acts.push({
      icon: "trash",
      label: "Удалить",
      danger: true,
      onClick: async () => {
        if (!(await confirmMsg(`Удалить «${file.name}»? Файл исчезнет и из Telegram.`))) return;
        setViewer(null);
        await run(() => Api.deleteFile(file.id), true);
      },
    });
    return acts;
  };

  const folderActions = (folder: FolderItem): SheetAction[] => [
    {
      icon: "edit",
      label: "Переименовать",
      onClick: () => setSheet({ type: "prompt", title: "Переименовать папку", initial: folder.name, ok: "Сохранить", submit: (name) => run(() => Api.updateFolder(folder.id, { name })) }),
    },
    { icon: "folderMove", label: "Переместить", onClick: () => setSheet({ type: "move", exclude: folder.id, pick: (parentId) => run(() => Api.updateFolder(folder.id, { parentId }), true) }) },
    {
      icon: "trash",
      label: "Удалить папку",
      danger: true,
      onClick: async () => {
        if (!(await confirmMsg(`Удалить папку «${folder.name}» со всем, что в ней лежит?`))) return;
        await run(() => Api.deleteFolder(folder.id), true);
      },
    },
  ];

  const splash = useSplash(me !== null || fatal !== null);

  if (fatal) return <Gate text={fatal.status === 403 ? "Доступ к этому хранилищу закрыт. Попросите владельца добавить вас." : fatal.text} />;
  if (!me) return splash ?? <div className="screen-center"><Loader /></div>;

  const searching = found !== null;
  const files = searching ? found : tab === "files" ? (listing?.files ?? []) : (media ?? []);
  const folders = !searching && tab === "files" ? (listing?.folders ?? []) : [];
  const loading = searching ? false : tab === "files" ? listing === null : media === null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand-row">
          <Sign height={34} busy={uploading} />
          <Wordmark size={24} />
          <span className="usage avr-body-sm avr-muted num">
            {plural(me.stats.count, ["файл", "файла", "файлов"])} · {formatSize(me.stats.size)}
          </span>
        </div>
        <label className="search">
          <Icon name="search" />
          <input placeholder="Искать файлы" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
          {query && (
            <button className="round-btn small" onClick={() => setQuery("")} aria-label="Очистить">
              <Icon name="close" size={20} />
            </button>
          )}
        </label>
        {!searching && tab === "files" && (
          <nav className="chips-row" aria-label="Путь">
            <button className="avr-chip" aria-pressed={!listing?.path.length} onClick={() => setFolderId(null)}>
              <Icon name="home" size={18} />
              Мои файлы
            </button>
            {listing?.path.map((p, i) => (
              <button key={p.id} className="avr-chip" aria-pressed={i === listing.path.length - 1} onClick={() => setFolderId(p.id)}>
                {p.name}
              </button>
            ))}
          </nav>
        )}
        {!searching && tab === "media" && (
          <div className="chips-row">
            {(
              [
                ["", "Всё"],
                ["image", "Фото"],
                ["video", "Видео"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className="avr-chip" aria-pressed={mediaKind === k} onClick={() => setMediaKind(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {!me.storageReady && (
        <div className="notice avr-body-sm">Хранилище ещё не настроено — администратору нужно указать STORAGE_CHANNEL_ID.</div>
      )}

      <main>
        {loading ? (
          <Loader />
        ) : searching && !files.length ? (
          <Empty title="Ничего не нашлось" text="Попробуйте другой запрос." />
        ) : tab === "media" && !searching ? (
          files.length ? (
            <MediaGrid files={files} onOpen={(f) => openFile(files, f)} />
          ) : (
            <Empty title="Фото и видео пока нет" text="Загрузите их — здесь появится галерея." action={pickFiles} />
          )
        ) : !folders.length && !files.length ? (
          <Empty title="Здесь пока ничего нет" text="Загрузите файлы или пришлите их боту в чат — они появятся здесь." action={pickFiles} />
        ) : (
          <>
            {folders.length > 0 && (
              <section>
                <div className="avr-kicker section-title">Папки</div>
                <div className="folder-grid">
                  {folders.map((f) => (
                    <div key={f.id} className="folder-card press" role="button" tabIndex={0} onClick={() => setFolderId(f.id)}>
                      <span className="folder-icon">
                        <Icon name="folder" />
                      </span>
                      <button
                        className="round-btn small"
                        aria-label="Действия с папкой"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSheet({ type: "folder", folder: f });
                        }}
                      >
                        <Icon name="more" size={20} />
                      </button>
                      <span className="avr-title-sm ellipsis">{f.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {files.length > 0 && (
              <section>
                <div className="avr-kicker section-title">{searching ? `Найдено: ${files.length}` : "Файлы"}</div>
                <div className="file-list">
                  {files.map((f) => (
                    <FileRow key={f.id} file={f} fresh={fresh.includes(f.id)} onOpen={() => openFile(files, f)} onMore={() => setSheet({ type: "file", file: f })} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <div className="dock">
        <UploadPanel />
      </div>
      <nav className="avr-island" aria-label="Разделы">
        <button aria-current={tab === "files" ? "page" : undefined} onClick={() => setTab("files")}>
          <Icon name="folder" />
          Файлы
        </button>
        <button className="island-fab" onClick={() => setSheet({ type: "add" })} aria-label="Добавить">
          <Icon name="plus" size={26} />
        </button>
        <button aria-current={tab === "media" ? "page" : undefined} onClick={() => setTab("media")}>
          <Icon name="image" />
          Медиа
        </button>
      </nav>

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
            { icon: "upload", label: "Загрузить файлы", onClick: pickFiles },
            {
              icon: "folderPlus",
              label: "Создать папку",
              onClick: () =>
                setSheet({
                  type: "prompt",
                  title: "Новая папка",
                  initial: "",
                  placeholder: "Название",
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
          leading={<Thumb file={sheet.file} />}
          actions={fileActions(sheet.file)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "folder" && (
        <ActionSheet
          title={sheet.folder.name}
          leading={
            <span className="folder-icon">
              <Icon name="folder" />
            </span>
          }
          actions={folderActions(sheet.folder)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "prompt" && (
        <PromptSheet title={sheet.title} initial={sheet.initial} okLabel={sheet.ok} placeholder={sheet.placeholder} onSubmit={sheet.submit} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === "move" && <MovePicker exclude={sheet.exclude} onPick={sheet.pick} onClose={() => setSheet(null)} />}
      {splash}
    </div>
  );
}

/** Заставка: звезда приходит поворотом, надпись поднимается — 1.1 с, потом 0.4 с растворения. Раз за запуск. */
function useSplash(ready: boolean) {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "gone" : "show",
  );
  const [minDone, setMinDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), 1100);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== "show" || !ready || !minDone) return;
    setPhase("fade");
    const t = setTimeout(() => setPhase("gone"), 400);
    return () => clearTimeout(t);
  }, [phase, ready, minDone]);
  if (phase === "gone") return null;
  return (
    <div className={`splash${phase === "fade" ? " fade" : ""}`} aria-hidden="true">
      <div className="splash-rings">
        <i style={{ ["--s" as string]: "180px", ["--a" as string]: 0.25 }} />
        <i style={{ ["--s" as string]: "260px", ["--a" as string]: 0.14, animationDelay: ".08s" }} />
        <i style={{ ["--s" as string]: "340px", ["--a" as string]: 0.07, animationDelay: ".16s" }} />
      </div>
      <Sign height={96} className="avr-star-in" />
      <div className="splash-word">
        <Wordmark size={40} />
      </div>
    </div>
  );
}

/** Экран входа: звёздное поле, вертикальная сборка и одна фраза. */
function Gate({ text }: { text: string }) {
  const ref = useStarfield<HTMLDivElement>();
  return (
    <div ref={ref} className="gate">
      <Sign height={88} className="avr-star-in" />
      <Wordmark size={36} />
      <p className="avr-body">{text}</p>
      {!tg && <p className="avr-body-sm avr-muted">avr cloud работает внутри Telegram — откройте его через бота.</p>}
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action?: () => void }) {
  return (
    <div className="empty">
      <Star size={80} className="empty-star" />
      <div className="avr-title">{title}</div>
      <p className="avr-body-sm avr-muted">{text}</p>
      {action && (
        <button className="avr-btn" onClick={action}>
          <Icon name="upload" />
          Загрузить
        </button>
      )}
    </div>
  );
}

function Thumb({ file }: { file: FileItem }) {
  const [broken, setBroken] = useState(false);
  if (file.thumbUrl && !broken) return <img className="thumb" src={file.thumbUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return (
    <div className={`thumb kind-${file.kind}`}>
      <Icon name={fileIconName(file.kind, file.name)} />
    </div>
  );
}

function FileRow({ file, fresh, onOpen, onMore }: { file: FileItem; fresh: boolean; onOpen: () => void; onMore: () => void }) {
  return (
    <div className="row press" role="button" tabIndex={0} onClick={onOpen}>
      <Thumb file={file} />
      <div className="row-main">
        <div className="avr-title-sm ellipsis">
          {fresh && <i className="avr-star avr-twinkle fresh" />}
          {file.name}
        </div>
        {file.status === "processing" ? (
          <div className="row-progress">
            <span className="avr-body-sm avr-muted num">Отправляется в Telegram · {percent(file.progress)}</span>
            <div className="avr-wavy" data-moving="" style={{ ["--v" as string]: `${file.progress * 100}%` }} />
          </div>
        ) : file.status === "error" ? (
          <div className="avr-body-sm danger-text ellipsis">{file.error || "Не удалось отправить"}</div>
        ) : (
          <div className="avr-body-sm avr-muted num ellipsis">
            {formatSize(file.size)}
            {file.duration ? ` · ${formatDuration(file.duration)}` : ""} · {formatDate(file.createdAt)}
            {file.shareUrl ? " · по ссылке" : ""}
          </div>
        )}
      </div>
      <button
        className="round-btn"
        aria-label="Действия с файлом"
        onClick={(e) => {
          e.stopPropagation();
          onMore();
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

function MediaGrid({ files, onOpen }: { files: FileItem[]; onOpen: (f: FileItem) => void }) {
  return (
    <div className="grid">
      {files.map((f) => (
        <button key={f.id} className="cell press" onClick={() => onOpen(f)}>
          <Thumb file={f} />
          {f.kind === "video" && <span className="badge num">{formatDuration(f.duration) || "Видео"}</span>}
        </button>
      ))}
    </div>
  );
}
