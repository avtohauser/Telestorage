import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return v;
}

const MiB = 1024 * 1024;

export const config = {
  botToken: required("BOT_TOKEN"),
  apiId: Number(required("API_ID")),
  apiHash: required("API_HASH"),
  // Может быть пустым при первом запуске: бот подскажет ID по команде /id в канале.
  storageChannelId: process.env.STORAGE_CHANNEL_ID || "",
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  port: Number(process.env.PORT || 8080),
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  webDir: path.resolve(process.env.WEB_DIR || "../web/dist"),
  // Пустой список = доступ для всех пользователей Telegram.
  allowedUserIds: (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  // Лимит одного сообщения в Telegram — 2 ГБ, файлы больше режутся на части.
  partSize: Number(process.env.PART_SIZE_MB || 1950) * MiB,
  maxFileSize: Number(process.env.MAX_FILE_SIZE_MB || 20480) * MiB,
  uploadChunkSize: 8 * MiB,
  uploadConcurrency: Number(process.env.UPLOAD_CONCURRENCY || 2),
  initDataTtlSec: 24 * 3600,
};
