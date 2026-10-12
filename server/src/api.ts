import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomToken, requireAuth, signMediaToken, verifyMediaToken } from "./auth.js";
import { config } from "./config.js";
import { db, type FileRow, type FolderRow, kindOf, now, tmpPath } from "./db.js";
import { streamFile } from "./stream.js";
import { deleteFromStorage, storageReady } from "./telegram.js";
import { enqueue, progress } from "./uploader.js";

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
// Если обработчик вернул значение — отдаём его как JSON.
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .then((result) => {
      if (result !== undefined && !res.headersSent) res.json(result);
    })
    .catch(next);

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function cleanName(name: unknown): string {
  const s = String(name ?? "")
    .replace(/[\u0000-\u001f/\\]/g, "_")
    .trim()
    .slice(0, 255);
  if (!s) throw new HttpError(400, "Пустое имя");
  return s;
}

function getFolder(userId: number, id: unknown): FolderRow | null {
  if (id === null || id === undefined || id === "" || id === "root") return null;
  const folder = db.prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?").get(Number(id), userId) as
    | FolderRow
    | undefined;
  if (!folder) throw new HttpError(404, "Папка не найдена");
  return folder;
}

function getFile(userId: number, id: unknown): FileRow {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(Number(id), userId) as
    | FileRow
    | undefined;
  if (!file) throw new HttpError(404, "Файл не найден");
  return file;
}

function shareUrl(token: string) {
  return `${config.publicUrl}/s/${token}`;
}

function serializeFile(f: FileRow) {
  const t = signMediaToken(f.id, f.user_id);
  return {
    id: f.id,
    folderId: f.folder_id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    kind: f.kind,
    width: f.width,
    height: f.height,
    duration: f.duration,
    status: f.status,
    received: f.received,
    progress: f.status === "processing" ? (progress.get(f.id) ?? 0) : f.status === "ready" ? 1 : 0,
    error: f.error,
    shareUrl: f.share_token ? shareUrl(f.share_token) : null,
    createdAt: f.created_at,
    thumbUrl: f.thumb ? `/api/files/${f.id}/thumb?t=${t}` : null,
    url: `/api/files/${f.id}/content?t=${t}`,
  };
}

const FILE_COLUMNS =
  "id, user_id, folder_id, name, mime, size, kind, width, height, duration, thumb IS NOT NULL AS thumb, status, received, error, share_token, created_at";

function folderPath(userId: number, folder: FolderRow | null) {
  const path: { id: number; name: string }[] = [];
  let cur = folder;
  while (cur) {
    path.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? (getFolder(userId, cur.parent_id) as FolderRow) : null;
  }
  return path;
}

/** Все id папок в поддереве (включая саму папку). */
function subtreeIds(userId: number, rootId: number): number[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE t(id) AS (SELECT id FROM folders WHERE id = ? AND user_id = ?
           UNION ALL SELECT f.id FROM folders f JOIN t ON f.parent_id = t.id)
         SELECT id FROM t`,
      )
      .all(rootId, userId) as { id: number }[]
  ).map((r) => r.id);
}

async function removeFiles(fileIds: number[]) {
  if (!fileIds.length) return;
  const marks = fileIds.map(() => "?").join(",");
  const messageIds = (
    db.prepare(`SELECT message_id FROM file_parts WHERE file_id IN (${marks})`).all(...fileIds) as {
      message_id: number;
    }[]
  ).map((r) => r.message_id);
  db.prepare(`DELETE FROM files WHERE id IN (${marks})`).run(...fileIds);
  for (const id of fileIds) fs.rmSync(tmpPath(id), { force: true });
  try {
    await deleteFromStorage(messageIds);
  } catch (e) {
    console.error("[delete] не удалось удалить сообщения из канала:", e);
  }
}

export function apiRouter() {
  const r = express.Router();

  // ---------- Медиа по подписанной ссылке (для <img>/<video>, без заголовков) ----------
  r.get(
    "/files/:id/thumb",
    wrap((req, res) => {
      const id = Number(req.params.id);
      const userId = verifyMediaToken(String(req.query.t || ""), id);
      if (userId === null) throw new HttpError(403, "Ссылка устарела");
      const row = db.prepare("SELECT thumb FROM files WHERE id = ? AND user_id = ?").get(id, userId) as
        | { thumb: Buffer | null }
        | undefined;
      if (!row?.thumb) throw new HttpError(404, "Нет превью");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(row.thumb);
    }),
  );

  const content = wrap(async (req, res) => {
    const id = Number(req.params.id);
    const userId = verifyMediaToken(String(req.query.t || ""), id);
    if (userId === null) throw new HttpError(403, "Ссылка устарела");
    const file = getFile(userId, id);
    if (file.status !== "ready") throw new HttpError(409, "Файл ещё загружается");
    await streamFile(req, res, file, req.query.download === "1");
  });
  r.get("/files/:id/content", content);
  r.head("/files/:id/content", content);

  // ---------- Всё остальное — только с валидным initData ----------
  r.use(requireAuth);
  r.use(express.json({ limit: "2mb" }));

  r.get(
    "/me",
    wrap((req) => {
      const stats = db
        .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS size FROM files WHERE user_id = ? AND status = 'ready'")
        .get(req.user!.id);
      return { user: req.user, storageReady: storageReady(), stats, chunkSize: config.uploadChunkSize, maxFileSize: config.maxFileSize };
    }),
  );

  r.get(
    "/list",
    wrap((req) => {
      const userId = req.user!.id;
      const folder = getFolder(userId, req.query.folder);
      const folders = db
        .prepare("SELECT id, name, created_at AS createdAt FROM folders WHERE user_id = ? AND parent_id IS ? ORDER BY name COLLATE NOCASE")
        .all(userId, folder?.id ?? null);
      const files = db
        .prepare(`SELECT ${FILE_COLUMNS} FROM files WHERE user_id = ? AND folder_id IS ? AND status != 'uploading' ORDER BY created_at DESC, id DESC`)
        .all(userId, folder?.id ?? null) as FileRow[];
      return { folder: folder ? { id: folder.id, name: folder.name } : null, path: folderPath(userId, folder), folders, files: files.map(serializeFile) };
    }),
  );

  r.get(
    "/search",
    wrap((req) => {
      const userId = req.user!.id;
      const q = String(req.query.q || "").trim();
      const kind = String(req.query.kind || "");
      const where = ["user_id = ?", "status != 'uploading'"];
      const args: unknown[] = [userId];
      if (q) {
        where.push("name LIKE ? ESCAPE '\\'");
        args.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
      }
      if (kind) {
        where.push("kind = ?");
        args.push(kind);
      }
      const files = db
        .prepare(`SELECT ${FILE_COLUMNS} FROM files WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT 500`)
        .all(...args) as FileRow[];
      return { files: files.map(serializeFile) };
    }),
  );

  r.get(
    "/folders",
    wrap((req) => ({
      folders: db.prepare("SELECT id, parent_id AS parentId, name FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(req.user!.id),
    })),
  );

  r.post(
    "/folders",
    wrap((req) => {
      const userId = req.user!.id;
      const parent = getFolder(userId, req.body.parentId);
      const info = db
        .prepare("INSERT INTO folders (user_id, parent_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, parent?.id ?? null, cleanName(req.body.name), now());
      return { id: Number(info.lastInsertRowid) };
    }),
  );

  r.patch(
    "/folders/:id",
    wrap((req) => {
      const userId = req.user!.id;
      const folder = getFolder(userId, req.params.id)!;
      if (req.body.name !== undefined) db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(cleanName(req.body.name), folder.id);
      if (req.body.parentId !== undefined) {
        const parent = getFolder(userId, req.body.parentId);
        if (parent && subtreeIds(userId, folder.id).includes(parent.id)) throw new HttpError(400, "Нельзя переместить папку внутрь самой себя");
        db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(parent?.id ?? null, folder.id);
      }
      return { ok: true };
    }),
  );

  r.delete(
    "/folders/:id",
    wrap(async (req) => {
      const userId = req.user!.id;
      const folder = getFolder(userId, req.params.id)!;
      const ids = subtreeIds(userId, folder.id);
      const fileIds = (
        db.prepare(`SELECT id FROM files WHERE folder_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: number }[]
      ).map((r) => r.id);
      await removeFiles(fileIds);
      db.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
      return { ok: true };
    }),
  );

  // ---------- Загрузка: init -> чанки -> отправка в Telegram в фоне ----------
  r.post(
    "/files/init",
    wrap((req) => {
      const userId = req.user!.id;
      if (!storageReady()) throw new HttpError(503, "Хранилище ещё не настроено");
      const folder = getFolder(userId, req.body.folderId);
      const size = Number(req.body.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(400, "Неверный размер");
      if (size > config.maxFileSize) throw new HttpError(413, "Файл слишком большой");
      const mime = String(req.body.mime || "application/octet-stream").slice(0, 127);
      let thumb: Buffer | null = null;
      if (typeof req.body.thumb === "string") {
        thumb = Buffer.from(req.body.thumb.replace(/^data:[^,]*,/, ""), "base64");
        if (thumb.length > 512 * 1024) thumb = null;
      }
      const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
      const info = db
        .prepare(
          `INSERT INTO files (user_id, folder_id, name, mime, size, kind, width, height, duration, thumb, status, received, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 0, ?)`,
        )
        .run(userId, folder?.id ?? null, cleanName(req.body.name), mime, size, kindOf(mime), num(req.body.width), num(req.body.height), num(req.body.duration), thumb, now());
      const id = Number(info.lastInsertRowid);
      fs.writeFileSync(tmpPath(id), "");
      if (size === 0) finishUpload(id);
      return { id, chunkSize: config.uploadChunkSize };
    }),
  );

  const writing = new Set<number>();
  r.put(
    "/files/:id/chunk",
    wrap(async (req) => {
      const file = getFile(req.user!.id, req.params.id);
      if (file.status !== "uploading") throw new HttpError(409, "Загрузка уже завершена");
      const offset = Number(req.query.offset);
      if (offset !== file.received) throw new HttpError(409, `Ожидался offset ${file.received}`);
      if (writing.has(file.id)) throw new HttpError(409, "Чанк уже пишется");
      writing.add(file.id);
      try {
        let written = 0;
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            written += chunk.length;
            if (offset + written > file.size) return cb(new HttpError(400, "Получено больше данных, чем заявлено"));
            if (written > config.uploadChunkSize * 2) return cb(new HttpError(413, "Слишком большой чанк"));
            cb(null, chunk);
          },
        });
        // Пишем с позиции offset: если чанк оборвался, повтор перезапишет те же байты.
        await pipeline(req, counter, fs.createWriteStream(tmpPath(file.id), { flags: "r+", start: offset }));
        const received = offset + written;
        db.prepare("UPDATE files SET received = ? WHERE id = ?").run(received, file.id);
        if (received === file.size) finishUpload(file.id);
        return { received };
      } finally {
        writing.delete(file.id);
      }
    }),
  );

  function finishUpload(id: number) {
    const file = db.prepare("SELECT size FROM files WHERE id = ?").get(id) as { size: number };
    fs.truncateSync(tmpPath(id), file.size);
    db.prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(id);
    enqueue(id);
  }

  r.get(
    "/files/:id",
    wrap((req) => serializeFile(getFile(req.user!.id, req.params.id))),
  );

  r.post(
    "/files/:id/retry",
    wrap((req) => {
      const file = getFile(req.user!.id, req.params.id);
      if (file.status !== "error") throw new HttpError(409, "Файл не в статусе ошибки");
      if (!fs.existsSync(tmpPath(file.id))) throw new HttpError(410, "Временный файл не сохранился, загрузите заново");
      db.prepare("UPDATE files SET status = 'processing', error = NULL WHERE id = ?").run(file.id);
      enqueue(file.id);
      return { ok: true };
    }),
  );

  r.patch(
    "/files/:id",
    wrap((req) => {
      const userId = req.user!.id;
      const file = getFile(userId, req.params.id);
      if (req.body.name !== undefined) db.prepare("UPDATE files SET name = ? WHERE id = ?").run(cleanName(req.body.name), file.id);
      if (req.body.folderId !== undefined) {
        const folder = getFolder(userId, req.body.folderId);
        db.prepare("UPDATE files SET folder_id = ? WHERE id = ?").run(folder?.id ?? null, file.id);
      }
      return serializeFile(getFile(userId, file.id));
    }),
  );

  r.delete(
    "/files/:id",
    wrap(async (req) => {
      const file = getFile(req.user!.id, req.params.id);
      await removeFiles([file.id]);
      return { ok: true };
    }),
  );

  r.post(
    "/files/:id/share",
    wrap((req) => {
      const file = getFile(req.user!.id, req.params.id);
      const token = req.body.enabled === false ? null : file.share_token || randomToken();
      db.prepare("UPDATE files SET share_token = ? WHERE id = ?").run(token, file.id);
      return { shareUrl: token ? shareUrl(token) : null };
    }),
  );

  r.use((_req, _res) => {
    throw new HttpError(404, "Not found");
  });

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("[api]", err);
    if (!res.headersSent) res.status(500).json({ error: "Внутренняя ошибка сервера" });
  });

  return r;
}
