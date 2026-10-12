import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "tmp"), { recursive: true });

export const db = new Database(path.join(config.dataDir, "telestorage.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_user_parent ON folders(user_id, parent_id);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration REAL,
  thumb BLOB,
  status TEXT NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  share_token TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_user_folder ON files(user_id, folder_id);
CREATE TABLE IF NOT EXISTS file_parts (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (file_id, idx)
);
`);

export type FileStatus = "uploading" | "processing" | "ready" | "error";

export interface FileRow {
  id: number;
  user_id: number;
  folder_id: number | null;
  name: string;
  mime: string;
  size: number;
  kind: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: Buffer | null;
  status: FileStatus;
  received: number;
  error: string | null;
  share_token: string | null;
  created_at: number;
}

export interface FolderRow {
  id: number;
  user_id: number;
  parent_id: number | null;
  name: string;
  created_at: number;
}

export interface PartRow {
  file_id: number;
  idx: number;
  message_id: number;
  size: number;
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function kindOf(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function tmpPath(fileId: number) {
  return path.join(config.dataDir, "tmp", `${fileId}.part`);
}

export function getParts(fileId: number): PartRow[] {
  return db.prepare("SELECT * FROM file_parts WHERE file_id = ? ORDER BY idx").all(fileId) as PartRow[];
}
