import type { Request, Response } from "express";
import { type FileRow, getParts } from "./db.js";
import { readStorageRange } from "./telegram.js";

function contentDisposition(type: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function parseRange(header: string | undefined, size: number): [number, number] | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}

/** Отдаёт файл из Telegram с поддержкой Range (перемотка видео, докачка). */
export async function streamFile(req: Request, res: Response, file: FileRow, download: boolean) {
  const size = file.size;
  const range = parseRange(req.header("range"), size);
  if (range === "invalid") {
    res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    return;
  }
  const [start, end] = range ?? [0, size - 1];
  res.status(range ? 206 : 200);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Length", String(size === 0 ? 0 : end - start + 1));
  res.setHeader("Content-Disposition", contentDisposition(download ? "attachment" : "inline", file.name));
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }

  let closed = false;
  res.on("close", () => (closed = true));
  const waitDrain = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        res.off("drain", done);
        res.off("close", done);
        resolve();
      };
      res.on("drain", done);
      res.on("close", done);
    });

  try {
    let partStart = 0;
    for (const part of getParts(file.id)) {
      const partEnd = partStart + part.size - 1;
      if (partEnd >= start && partStart <= end) {
        const from = Math.max(start, partStart) - partStart;
        const to = Math.min(end, partEnd) - partStart;
        for await (const chunk of readStorageRange(part.message_id, from, to)) {
          if (closed) return;
          if (!res.write(chunk)) await waitDrain();
        }
      }
      partStart += part.size;
      if (partStart > end) break;
    }
    res.end();
  } catch (e) {
    console.error(`[stream] файл ${file.id}:`, e);
    if (!res.headersSent) {
      for (const h of ["Content-Length", "Content-Range", "Content-Disposition", "Content-Type"]) res.removeHeader(h);
      res.status(502).end();
    }
    else res.destroy();
  }
}
