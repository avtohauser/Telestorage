const NBSP = " ";

export function formatSize(size: number) {
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  const n = size.toLocaleString("ru-RU", { maximumFractionDigits: i && size < 100 ? 1 : 0 });
  return `${n}${NBSP}${units[i]}`;
}

export function formatDuration(sec: number | null) {
  if (!sec) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatDate(ts: number) {
  const d = new Date(ts * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).replace(" г.", "");
}

/** plural(5, ["файл", "файла", "файлов"]) → «5 файлов» */
export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const form = a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2];
  return `${n.toLocaleString("ru-RU")}${NBSP}${form}`;
}

export const percent = (v: number) => `${Math.round(v * 100)}${NBSP}%`;
