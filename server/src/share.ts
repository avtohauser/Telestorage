import express from "express";
import { db, type FileRow } from "./db.js";
import { streamFile } from "./stream.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Знак avr cloud: звезда и облако со стрелкой (поле 140 × 100)
const SIGN = `<svg height="32" viewBox="0 0 140 100" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#F2A5C3"/><stop offset="1" stop-color="#5A4FC8"/></linearGradient></defs><path fill="url(#g)" d="M50 2C53 30 70 47 98 50C70 53 53 70 50 98C47 70 30 53 2 50C30 47 47 30 50 2Z"/><path d="M115.3 62.8H129.7A8 8 0 0 0 131.3 47A10.4 10.4 0 0 0 111.6 45.2A8.8 8.8 0 0 0 115.3 62.8Z" fill="none" stroke="#5A4FC8" stroke-width="6" stroke-linejoin="round"/><path d="M122.5 58.5V48.5M118.3 52.7L122.5 48.5L126.7 52.7" fill="none" stroke="#F2A5C3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function human(size: number) {
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toLocaleString("ru-RU", { maximumFractionDigits: i ? 1 : 0 })}\u00a0${units[i]}`;
}

function byToken(token: string) {
  return db.prepare("SELECT * FROM files WHERE share_token = ? AND status = 'ready'").get(token) as FileRow | undefined;
}

/** Публичные ссылки: открываются в любом браузере, без Telegram. */
export function shareRouter() {
  const r = express.Router();

  r.get("/:token", (req, res) => {
    const file = byToken(req.params.token);
    if (!file) return res.status(404).type("text/plain; charset=utf-8").send("Ссылка больше не работает — владелец закрыл доступ или удалил файл.");
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(file.name)} — avr cloud</title>
<meta property="og:title" content="${esc(file.name)}"><meta property="og:description" content="${human(file.size)} · avr cloud">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
@font-face{font-family:"Google Sans Flex";font-stretch:100% 112%;font-weight:400 900;font-display:swap;src:url(/fonts/gsf-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:"Roboto Flex";font-stretch:100% 112%;font-weight:400 900;font-display:swap;src:url(/fonts/rf-cyrillic.woff2) format("woff2");unicode-range:U+0400-045F,U+0490-0491,U+2116}
@font-face{font-family:"Outfit";font-weight:300 500;font-display:swap;src:url(/fonts/outfit-latin.woff2) format("woff2")}
:root{color-scheme:light;--bg:#E9EFEF;--card:#F3F7F7;--fg:#0B4248;--muted:#3E5F63;--primary:#5A4FC8;--on-primary:#fff;--accent:#5A4FC8;--line:#BCCFD1;
--font:"Google Sans Flex","Roboto Flex",system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0B4248;--card:#0E4A50;--fg:#D3E3E4;--muted:#A9C4C6;--primary:#F2A5C3;--on-primary:#3B0D26;--accent:#F2A5C3;--line:#2A6168}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:420 16px/1.5 var(--font);-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;align-items:center;padding:20px 16px 32px}
header{width:100%;max-width:720px;display:flex;align-items:center;gap:10px;margin-bottom:16px}
.word{font-family:"Outfit",var(--font);font-weight:500;font-size:22px;letter-spacing:-.026em;line-height:1}.word i{font-style:normal;font-weight:300;margin-left:.14em;color:var(--accent)}
.card{background:var(--card);border-radius:30px;padding:20px;max-width:720px;width:100%}
h1{font:680 20px/26px var(--font);font-variation-settings:"wght" 680,"wdth" 106,"ROND" 80;margin:0;word-break:break-word}
.muted{color:var(--muted);font-size:14px;font-variant-numeric:tabular-nums}
img,video{display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:18px;margin:16px 0 0;background:#021A1D}
audio{width:100%;margin:16px 0 0}
a.btn{display:flex;align-items:center;justify-content:center;gap:8px;height:52px;margin-top:18px;border-radius:999px;background:var(--primary);color:var(--on-primary);text-decoration:none;font:620 16px/1 var(--font);transition:border-radius .35s cubic-bezier(.34,1.56,.64,1),transform .3s cubic-bezier(.34,1.56,.64,1)}
a.btn:active{transform:scale(.97);border-radius:16px}
footer{margin-top:18px;font-size:13px;color:var(--muted)}
</style></head><body>
<header>${SIGN}<span class="word">avr<i>cloud</i></span></header>
<main class="card">
<h1>${esc(file.name)}</h1><div class="muted">${human(file.size)}</div>
${preview}
<a class="btn" href="${src}?download=1"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>Скачать</a>
</main>
<footer>Файлом поделились через avr cloud</footer>
</body></html>`);
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
