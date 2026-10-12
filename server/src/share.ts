import express from "express";
import { db, type FileRow } from "./db.js";
import { streamFile } from "./stream.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function human(size: number) {
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function byToken(token: string) {
  return db.prepare("SELECT * FROM files WHERE share_token = ? AND status = 'ready'").get(token) as FileRow | undefined;
}

/** Публичные ссылки: открываются в любом браузере, без Telegram. */
export function shareRouter() {
  const r = express.Router();

  r.get("/:token", (req, res) => {
    const file = byToken(req.params.token);
    if (!file) return res.status(404).send("Ссылка недействительна");
    const src = `/s/${encodeURIComponent(req.params.token)}/file`;
    const preview =
      file.kind === "image"
        ? `<img src="${src}" alt="">`
        : file.kind === "video"
          ? `<video src="${src}" controls playsinline preload="metadata"></video>`
          : file.kind === "audio"
            ? `<audio src="${src}" controls></audio>`
            : "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(file.name)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f4f5;--card:#fff;--fg:#111;--muted:#71717a;--accent:#2481cc}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--card:#232327;--fg:#f4f4f5;--muted:#a1a1aa}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif;display:flex;justify-content:center;padding:24px 16px}
.card{background:var(--card);border-radius:16px;padding:20px;max-width:720px;width:100%;box-sizing:border-box}
h1{font-size:18px;margin:0 0 4px;word-break:break-word}.muted{color:var(--muted);font-size:14px}
img,video,audio{width:100%;max-height:70vh;object-fit:contain;border-radius:12px;margin:16px 0;background:#000}
audio{background:none}
a.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;padding:12px;border-radius:12px;margin-top:16px;font-weight:600}
</style></head><body><div class="card">
<h1>${esc(file.name)}</h1><div class="muted">${human(file.size)}</div>
${preview}
<a class="btn" href="${src}?download=1">Скачать</a>
</div></body></html>`);
  });

  const file = (req: express.Request, res: express.Response) => {
    const f = byToken(req.params.token);
    if (!f) return res.status(404).end();
    void streamFile(req, res, f, req.query.download === "1");
  };
  r.get("/:token/file", file);
  r.head("/:token/file", file);
  return r;
}
