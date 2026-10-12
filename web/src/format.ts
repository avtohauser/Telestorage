export function formatSize(size: number) {
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i && size < 100 ? 1 : 0)} ${units[i]}`;
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
  return new Date(ts * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function fileIcon(kind: string, name: string) {
  if (kind === "image") return "🖼️";
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) return "📄";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["apk", "exe", "dmg"].includes(ext)) return "📦";
  return "📎";
}
