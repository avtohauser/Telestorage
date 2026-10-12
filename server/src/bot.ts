import { Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { isAllowed, upsertUser } from "./auth.js";
import { config } from "./config.js";
import { db, kindOf, now } from "./db.js";
import { client, downloadThumb, forwardToStorage, mediaInfo, storageReady } from "./telegram.js";

function openAppMarkup() {
  if (!config.publicUrl) return undefined;
  return new Api.ReplyInlineMarkup({
    rows: [
      new Api.KeyboardButtonRow({
        buttons: [new Api.KeyboardButtonWebView({ text: "📂 Открыть хранилище", url: config.publicUrl })],
      }),
    ],
  });
}

export async function setupBot() {
  if (config.publicUrl) {
    await client
      .invoke(
        new Api.bots.SetBotMenuButton({
          userId: new Api.InputUserEmpty(),
          button: new Api.BotMenuButton({ text: "Хранилище", url: config.publicUrl }),
        }),
      )
      .catch((e) => console.warn("[bot] не удалось установить кнопку меню:", e.errorMessage || e));
  }
  await client
    .invoke(
      new Api.bots.SetBotCommands({
        scope: new Api.BotCommandScopeDefault(),
        langCode: "",
        commands: [
          new Api.BotCommand({ command: "start", description: "Открыть хранилище" }),
          new Api.BotCommand({ command: "help", description: "Как пользоваться" }),
        ],
      }),
    )
    .catch(() => undefined);

  client.addEventHandler((e: NewMessageEvent) => {
    onMessage(e).catch((err) => console.error("[bot]", err));
  }, new NewMessage({ incoming: true }));
}

const HELP =
  "Это облачное хранилище на серверах Telegram.\n\n" +
  "• Откройте приложение кнопкой ниже, чтобы загружать файлы, создавать папки и смотреть фото/видео.\n" +
  "• Или просто пришлите мне фото, видео или документ — я сохраню их в корень хранилища.";

async function onMessage(e: NewMessageEvent) {
  const msg = e.message;
  const text = (msg.message || "").trim();

  // Помощь с настройкой: напишите /id в канале, где бот — админ.
  if (msg.isChannel && /^\/id(@\w+)?$/.test(text)) {
    const chatId = msg.chatId?.toString();
    await msg.reply({ message: `ID этого канала: ${chatId?.startsWith("-") ? chatId : "-100" + chatId}\nУкажите его в STORAGE_CHANNEL_ID.` });
    return;
  }
  if (!msg.isPrivate) return;

  const userId = Number(msg.senderId);
  if (!isAllowed(userId)) {
    await msg.reply({ message: `⛔ Доступ закрыт. Ваш ID: ${userId}` });
    return;
  }

  if (/^\/(start|help)\b/.test(text)) {
    await msg.reply({ message: HELP, buttons: openAppMarkup() });
    return;
  }

  const info = mediaInfo(msg);
  if (!info) {
    if (text) await msg.reply({ message: "Пришлите файл, фото или видео — я его сохраню.", buttons: openAppMarkup() });
    return;
  }
  if (!storageReady()) {
    await msg.reply({ message: "Хранилище ещё не настроено администратором." });
    return;
  }

  const sender = await msg.getSender();
  if (sender instanceof Api.User) upsertUser({ id: userId, first_name: sender.firstName, username: sender.username });

  const fromPeer = await msg.getInputChat();
  if (!fromPeer) throw new Error("Не удалось определить чат");
  const stored = await forwardToStorage(fromPeer as Api.TypeInputPeer, msg.id);
  const storedInfo = mediaInfo(stored) ?? info;
  const thumb = await downloadThumb(stored, storedInfo);
  const mime = storedInfo.mime;
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO files (user_id, folder_id, name, mime, size, kind, width, height, duration, thumb, status, received, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
      )
      .run(userId, storedInfo.name, mime, storedInfo.size, kindOf(mime), storedInfo.width ?? null, storedInfo.height ?? null, storedInfo.duration ?? null, thumb, storedInfo.size, now());
    const fileId = Number(res.lastInsertRowid);
    db.prepare("INSERT INTO file_parts (file_id, idx, message_id, size) VALUES (?, 0, ?, ?)").run(fileId, stored.id, storedInfo.size);
  });
  tx();
  await msg.reply({ message: `✅ Сохранено: ${storedInfo.name}`, buttons: openAppMarkup() });
}
