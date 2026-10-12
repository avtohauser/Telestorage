import { useSyncExternalStore } from "react";
import { Api, ApiError, api, authHeader } from "./api";

export interface UploadTask {
  key: string;
  name: string;
  size: number;
  folderId: number | null;
  sent: number;
  stage: "queued" | "sending" | "processing" | "done" | "error";
  progress: number; // 0..1 — для processing: отправка в Telegram
  error?: string;
  fileId?: number;
  file: File;
}

let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();
const doneListeners = new Set<(t: UploadTask) => void>();
let running = false;

function emit() {
  tasks = [...tasks];
  listeners.forEach((l) => l());
}

function update(t: UploadTask, patch: Partial<UploadTask>) {
  Object.assign(t, patch);
  emit();
}

export function useUploads() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => tasks,
  );
}

export function onUploadDone(cb: (t: UploadTask) => void) {
  doneListeners.add(cb);
  return () => {
    doneListeners.delete(cb);
  };
}

export function clearFinished() {
  tasks = tasks.filter((t) => t.stage !== "done" && t.stage !== "error");
  emit();
}

export function retryTask(t: UploadTask) {
  update(t, { stage: "queued", error: undefined });
  void run();
}

export function addUploads(files: FileList | File[], folderId: number | null) {
  for (const file of Array.from(files)) {
    tasks.push({
      key: `${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      folderId,
      sent: 0,
      stage: "queued",
      progress: 0,
      file,
    });
  }
  emit();
  void run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    let next: UploadTask | undefined;
    while ((next = tasks.find((t) => t.stage === "queued"))) {
      try {
        await uploadOne(next);
      } catch (e) {
        update(next, { stage: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    running = false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadOne(t: UploadTask) {
  update(t, { stage: "sending" });
  if (!t.fileId) {
    const meta = await describe(t.file);
    const init = await api<{ id: number }>("POST", "/files/init", {
      name: t.name,
      size: t.size,
      mime: t.file.type || guessMime(t.name),
      folderId: t.folderId,
      ...meta,
    });
    t.fileId = init.id;
  }
  let info = await Api.file(t.fileId);
  if (info.status === "error") {
    try {
      await Api.retryFile(t.fileId); // временный файл ещё на сервере — просто повторяем отправку в Telegram
      info = await Api.file(t.fileId);
    } catch {
      t.fileId = undefined; // временного файла нет — загружаем заново
      return uploadOne(t);
    }
  }
  let offset = info.received;
  if (info.status === "uploading") {
    const me = await Api.me();
    const chunk = me.chunkSize;
    let failures = 0;
    while (offset < t.size) {
      const end = Math.min(offset + chunk, t.size);
      try {
        const res = await putChunk(t.fileId, offset, t.file.slice(offset, end), (loaded) => update(t, { sent: offset + loaded }));
        offset = res.received;
        failures = 0;
        update(t, { sent: offset });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          offset = (await Api.file(t.fileId)).received; // сервер подскажет, откуда продолжать
          continue;
        }
        if (e instanceof ApiError && e.status < 500) throw e;
        if (++failures > 6) throw e;
        await sleep(1000 * 2 ** failures); // сеть моргнула — докачиваем с того же места
      }
    }
  }
  update(t, { stage: "processing", sent: t.size });
  // Сервер отправляет файл в Telegram — ждём и показываем прогресс.
  for (;;) {
    const f = await Api.file(t.fileId);
    if (f.status === "ready") {
      update(t, { stage: "done", progress: 1 });
      doneListeners.forEach((l) => l(t));
      return;
    }
    if (f.status === "error") throw new Error(f.error || "Ошибка отправки в Telegram");
    update(t, { progress: f.progress });
    await sleep(1500);
  }
}

function putChunk(id: number, offset: number, blob: Blob, onProgress: (loaded: number) => void) {
  return new Promise<{ received: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/${id}/chunk?offset=${offset}`);
    for (const [k, v] of Object.entries(authHeader())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data: { received?: number; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* пустой ответ */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ received: data.received ?? offset + blob.size });
      else reject(new ApiError(xhr.status, data.error || `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Нет соединения"));
    xhr.send(blob);
  });
}

function guessMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
    mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
    pdf: "application/pdf", zip: "application/zip",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

interface Meta {
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
}

const THUMB = 360;

function drawThumb(src: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, THUMB / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** Превью и размеры считаем прямо в браузере, чтобы серверу не нужен был ffmpeg. */
async function describe(file: File): Promise<Meta> {
  try {
    if (file.type.startsWith("image/")) {
      const bmp = await createImageBitmap(file);
      const meta = { width: bmp.width, height: bmp.height, thumb: drawThumb(bmp, bmp.width, bmp.height) };
      bmp.close();
      return meta;
    }
    if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      return await mediaMeta(file);
    }
  } catch {
    /* превью необязательно */
  }
  return {};
}

function mediaMeta(file: File): Promise<Meta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    let settled = false;
    const finish = (meta: Meta) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
      resolve(meta);
    };
    const timer = setTimeout(() => finish({ duration: Number.isFinite(v.duration) ? v.duration : undefined }), 8000);
    v.onloadedmetadata = () => {
      if (!v.videoWidth) {
        clearTimeout(timer);
        finish({ duration: v.duration });
        return;
      }
      v.currentTime = Math.min(1, v.duration / 10 || 0);
    };
    v.onseeked = () => {
      clearTimeout(timer);
      finish({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, thumb: drawThumb(v, v.videoWidth, v.videoHeight) });
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish({});
    };
    v.src = url;
  });
}
