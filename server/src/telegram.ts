import fs from "node:fs";
import path from "node:path";
import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { FileMigrateError } from "telegram/errors/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "./config.js";

const sessionFile = path.join(config.dataDir, "session.txt");

export const client = new TelegramClient(
  new StringSession(fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8").trim() : ""),
  config.apiId,
  config.apiHash,
  { connectionRetries: 10, autoReconnect: true },
);
client.setLogLevel("warn" as never);

let channel: Api.TypeInputPeer | null = null;

export async function startTelegram() {
  // Сессия сохраняется, чтобы не логиниться ботом при каждом рестарте (иначе можно словить FLOOD_WAIT).
  await client.start({ botAuthToken: config.botToken });
  fs.writeFileSync(sessionFile, (client.session as StringSession).save());
  const me = (await client.getMe()) as Api.User;
  console.log(`[tg] вошли как @${me.username}`);
  if (config.storageChannelId) {
    channel = await resolveChannel(config.storageChannelId);
    console.log(`[tg] канал-хранилище подключён: ${config.storageChannelId}`);
  } else {
    console.warn("[tg] STORAGE_CHANNEL_ID не задан. Добавьте бота админом в приватный канал и напишите там /id");
  }
  return me;
}

async function resolveChannel(id: string) {
  const raw = id.replace(/^-100/, "");
  return client.getInputEntity(new Api.PeerChannel({ channelId: bigInt(raw) }));
}

export function storageReady() {
  return channel !== null;
}

function storage() {
  if (!channel) throw new Error("Канал-хранилище не настроен (STORAGE_CHANNEL_ID)");
  return channel;
}

/** Загружает файл с диска в канал-хранилище, возвращает id сообщения. */
export async function uploadToStorage(
  filePath: string,
  name: string,
  size: number,
  caption: string,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  const msg = await client.sendFile(storage(), {
    file: new CustomFile(name, size, filePath),
    forceDocument: true,
    caption,
    workers: 4,
    progressCallback: onProgress,
  });
  return msg.id;
}

/** Пересылает сообщение с медиа (например, присланное боту) в канал-хранилище. */
export async function forwardToStorage(fromPeer: Api.TypeInputPeer, messageId: number): Promise<Api.Message> {
  const [msg] = await client.forwardMessages(storage(), { messages: [messageId], fromPeer });
  if (!msg) throw new Error("Не удалось переслать сообщение");
  return msg;
}

export async function deleteFromStorage(messageIds: number[]) {
  if (!messageIds.length) return;
  for (let i = 0; i < messageIds.length; i += 100) {
    await client.deleteMessages(storage(), messageIds.slice(i, i + 100), { revoke: true });
  }
}

export interface MediaInfo {
  location: Api.TypeInputFileLocation;
  dcId: number;
  size: number;
  mime: string;
  name: string;
  thumb?: Api.TypePhotoSize;
  width?: number;
  height?: number;
  duration?: number;
}

function largestPhotoSize(photo: Api.Photo) {
  let best: { type: string; size: number; w: number; h: number } | null = null;
  for (const s of photo.sizes) {
    let size = 0;
    if (s instanceof Api.PhotoSize) size = s.size;
    else if (s instanceof Api.PhotoSizeProgressive) size = Math.max(...s.sizes);
    else continue;
    if (!best || size > best.size) best = { type: s.type, size, w: s.w, h: s.h };
  }
  return best;
}

function pickThumb(sizes: Api.TypePhotoSize[] | undefined) {
  // Берём самую маленькую «настоящую» миниатюру (не stripped-превью размером 40px).
  const real = (sizes || []).filter((s) => s instanceof Api.PhotoSize || s instanceof Api.PhotoSizeProgressive) as (
    | Api.PhotoSize
    | Api.PhotoSizeProgressive
  )[];
  real.sort((a, b) => a.w - b.w);
  return real.find((s) => s.w >= 200) || real[real.length - 1];
}

/** Извлекает из сообщения всё, что нужно для скачивания файла по MTProto. */
export function mediaInfo(msg: Api.Message): MediaInfo | null {
  const media = msg.media;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const d = media.document;
    let name = "file";
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;
    for (const a of d.attributes) {
      if (a instanceof Api.DocumentAttributeFilename) name = a.fileName;
      if (a instanceof Api.DocumentAttributeVideo || a instanceof Api.DocumentAttributeImageSize) {
        width = a.w;
        height = a.h;
      }
      if (a instanceof Api.DocumentAttributeVideo || a instanceof Api.DocumentAttributeAudio) duration = a.duration;
    }
    return {
      location: new Api.InputDocumentFileLocation({
        id: d.id,
        accessHash: d.accessHash,
        fileReference: d.fileReference,
        thumbSize: "",
      }),
      dcId: d.dcId,
      size: d.size.toJSNumber(),
      mime: d.mimeType || "application/octet-stream",
      name,
      thumb: pickThumb(d.thumbs),
      width,
      height,
      duration,
    };
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const p = media.photo;
    const largest = largestPhotoSize(p);
    if (!largest) return null;
    return {
      location: new Api.InputPhotoFileLocation({
        id: p.id,
        accessHash: p.accessHash,
        fileReference: p.fileReference,
        thumbSize: largest.type,
      }),
      dcId: p.dcId,
      size: largest.size,
      mime: "image/jpeg",
      name: `photo_${msg.id}.jpg`,
      thumb: pickThumb(p.sizes),
      width: largest.w,
      height: largest.h,
    };
  }
  return null;
}

export async function downloadThumb(msg: Api.Message, info: MediaInfo): Promise<Buffer | null> {
  if (!info.thumb) return null;
  try {
    const buf = await client.downloadMedia(msg, { thumb: info.thumb });
    return Buffer.isBuffer(buf) ? buf : null;
  } catch {
    return null;
  }
}

// Кэш file_reference: он протухает, поэтому при ошибке перечитываем сообщение.
const infoCache = new Map<number, { info: MediaInfo; at: number }>();
const CACHE_TTL = 30 * 60 * 1000;

async function getStorageMedia(messageId: number, fresh = false): Promise<MediaInfo> {
  const cached = infoCache.get(messageId);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL) return cached.info;
  const [msg] = await client.getMessages(storage(), { ids: [messageId] });
  const info = msg ? mediaInfo(msg) : null;
  if (!info) throw new Error(`Сообщение ${messageId} в хранилище не найдено`);
  infoCache.set(messageId, { info, at: Date.now() });
  return info;
}

const CHUNK = 512 * 1024; // максимум для upload.getFile; 1 МБ кратен ему, поэтому выравнивание всегда валидно

/**
 * Читает байты [start, end] (включительно) файла из сообщения в канале.
 * Нужен для Range-запросов: перемотка видео, докачка.
 */
export async function* readStorageRange(messageId: number, start: number, end: number): AsyncGenerator<Buffer> {
  let info = await getStorageMedia(messageId);
  let dcId = info.dcId;
  let offset = Math.floor(start / CHUNK) * CHUNK;
  let refreshed = false;

  while (offset <= end) {
    let bytes: Buffer;
    try {
      const sender = await client.getSender(dcId);
      const res = await client.invokeWithSender(
        new Api.upload.GetFile({ location: info.location, offset: bigInt(offset), limit: CHUNK, precise: false }),
        sender,
      );
      if (!(res instanceof Api.upload.File)) throw new Error("CDN-файлы не поддерживаются");
      bytes = res.bytes;
    } catch (e) {
      if (e instanceof FileMigrateError) {
        dcId = e.newDc;
        continue;
      }
      const message = (e as { errorMessage?: string }).errorMessage || "";
      if (message.startsWith("FILE_REFERENCE_") && !refreshed) {
        refreshed = true;
        info = await getStorageMedia(messageId, true);
        continue;
      }
      throw e;
    }
    if (bytes.length === 0) return;
    const from = Math.max(start - offset, 0);
    const to = Math.min(bytes.length, end - offset + 1);
    yield bytes.subarray(from, to);
    if (bytes.length < CHUNK) return;
    offset += CHUNK;
  }
}
