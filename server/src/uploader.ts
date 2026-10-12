import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { db, type FileRow, now, tmpPath } from "./db.js";
import { deleteFromStorage, storageReady, uploadToStorage } from "./telegram.js";

/** Прогресс отправки в Telegram (0..1) для файлов в статусе processing. */
export const progress = new Map<number, number>();

const queue: number[] = [];
let active = 0;

export function enqueue(fileId: number) {
  if (queue.includes(fileId)) return;
  queue.push(fileId);
  progress.set(fileId, 0);
  pump();
}

function pump() {
  while (active < config.uploadConcurrency && queue.length) {
    const id = queue.shift()!;
    active++;
    process(id)
      .catch((e) => {
        console.error(`[upload] файл ${id}:`, e);
        db.prepare("UPDATE files SET status = 'error', error = ? WHERE id = ?").run(String(e?.message || e), id);
      })
      .finally(() => {
        active--;
        progress.delete(id);
        pump();
      });
  }
}

async function process(fileId: number) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as FileRow | undefined;
  if (!file || file.status !== "processing") return;
  const src = tmpPath(fileId);
  if (file.size === 0) {
    // Пустые файлы Telegram не принимает — храним только запись в БД.
    db.prepare("UPDATE files SET status = 'ready', error = NULL WHERE id = ?").run(fileId);
    fs.rmSync(src, { force: true });
    return;
  }
  if (!storageReady()) throw new Error("Канал-хранилище не настроен");
    const parts = Math.max(1, Math.ceil(file.size / config.partSize));
  const insertPart = db.prepare("INSERT OR REPLACE INTO file_parts (file_id, idx, message_id, size) VALUES (?, ?, ?, ?)");
  const done = new Set(
    (db.prepare("SELECT idx FROM file_parts WHERE file_id = ?").all(fileId) as { idx: number }[]).map((r) => r.idx),
  );

  for (let idx = 0; idx < parts; idx++) {
    if (done.has(idx)) continue;
    const start = idx * config.partSize;
    const size = Math.min(config.partSize, file.size - start);
    const name = parts === 1 ? file.name : `${file.name}.part${String(idx + 1).padStart(3, "0")}`;
    const caption = `#u${file.user_id} #f${file.id}${parts > 1 ? ` part ${idx + 1}/${parts}` : ""}\n${file.name}`;

    // GramJS читает файл с начала, поэтому каждую часть большого файла сначала выносим в отдельный temp-файл.
    let partPath = src;
    if (parts > 1) {
      partPath = `${src}.${idx}`;
      await pipeline(fs.createReadStream(src, { start, end: start + size - 1 }), fs.createWriteStream(partPath));
    }
    try {
      const messageId = await uploadToStorage(partPath, name, size, caption, (f) => {
        progress.set(fileId, (idx + f) / parts);
      });
      if (!db.prepare("SELECT 1 FROM files WHERE id = ?").get(fileId)) {
        // Файл удалили, пока он отправлялся: убираем то, что уже успели залить.
        const sent = (db.prepare("SELECT message_id FROM file_parts WHERE file_id = ?").all(fileId) as { message_id: number }[]).map((r) => r.message_id);
        await deleteFromStorage([...sent, messageId]);
        return;
      }
      insertPart.run(fileId, idx, messageId, size);
    } finally {
      if (partPath !== src) fs.rmSync(partPath, { force: true });
    }
  }

  db.prepare("UPDATE files SET status = 'ready', error = NULL WHERE id = ?").run(fileId);
  fs.rmSync(src, { force: true });
  console.log(`[upload] готово: #${fileId} ${file.name} (${parts} ч.)`);
}

/** После рестарта: доотправить то, что успели принять, и почистить брошенные загрузки. */
export function recoverUploads() {
  const processing = db.prepare("SELECT id FROM files WHERE status = 'processing'").all() as { id: number }[];
  for (const { id } of processing) {
    if (fs.existsSync(tmpPath(id))) enqueue(id);
    else db.prepare("UPDATE files SET status = 'error', error = 'Временный файл потерян' WHERE id = ?").run(id);
  }
  const stale = db
    .prepare("SELECT id FROM files WHERE status = 'uploading' AND created_at < ?")
    .all(now() - 3 * 24 * 3600) as { id: number }[];
  for (const { id } of stale) {
    fs.rmSync(tmpPath(id), { force: true });
    db.prepare("DELETE FROM files WHERE id = ?").run(id);
  }
}
