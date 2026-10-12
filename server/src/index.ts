import fs from "node:fs";
import path from "node:path";
import express from "express";
import { apiRouter } from "./api.js";
import { setupBot } from "./bot.js";
import { config } from "./config.js";
import { shareRouter } from "./share.js";
import { startTelegram } from "./telegram.js";
import { recoverUploads } from "./uploader.js";

async function main() {
  await startTelegram();
  await setupBot();
  recoverUploads();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use("/api", apiRouter());
  app.use("/s", shareRouter());

  if (fs.existsSync(config.webDir)) {
    app.use(express.static(config.webDir, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(config.webDir, "index.html")));
  } else {
    console.warn(`[http] сборка фронтенда не найдена в ${config.webDir}`);
  }

  app.listen(config.port, () => console.log(`[http] слушаем :${config.port}, публичный адрес ${config.publicUrl || "(PUBLIC_URL не задан)"}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
