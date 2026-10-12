import { tg } from "./tg";

export interface FileItem {
  id: number;
  folderId: number | null;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "audio" | "document";
  width: number | null;
  height: number | null;
  duration: number | null;
  status: "uploading" | "processing" | "ready" | "error";
  received: number;
  progress: number;
  error: string | null;
  shareUrl: string | null;
  createdAt: number;
  thumbUrl: string | null;
  url: string;
}

export interface FolderItem {
  id: number;
  name: string;
  parentId?: number | null;
}

export interface Listing {
  folder: FolderItem | null;
  path: FolderItem[];
  folders: FolderItem[];
  files: FileItem[];
}

export interface Me {
  user: { id: number; first_name?: string; username?: string };
  storageReady: boolean;
  stats: { count: number; size: number };
  chunkSize: number;
  maxFileSize: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function authHeader(): Record<string, string> {
  const initData = tg?.initData || import.meta.env.VITE_DEV_INIT_DATA || "";
  return initData ? { Authorization: `tma ${initData}` } : {};
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...authHeader(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Ошибка ${res.status}`);
  return data as T;
}

export const Api = {
  me: () => api<Me>("GET", "/me"),
  list: (folderId: number | null) => api<Listing>("GET", `/list?folder=${folderId ?? ""}`),
  search: (q: string, kind = "") => api<{ files: FileItem[] }>("GET", `/search?q=${encodeURIComponent(q)}&kind=${kind}`),
  allFolders: () => api<{ folders: FolderItem[] }>("GET", "/folders"),
  createFolder: (name: string, parentId: number | null) => api<{ id: number }>("POST", "/folders", { name, parentId }),
  updateFolder: (id: number, patch: { name?: string; parentId?: number | null }) => api("PATCH", `/folders/${id}`, patch),
  deleteFolder: (id: number) => api("DELETE", `/folders/${id}`),
  file: (id: number) => api<FileItem>("GET", `/files/${id}`),
  updateFile: (id: number, patch: { name?: string; folderId?: number | null }) => api<FileItem>("PATCH", `/files/${id}`, patch),
  deleteFile: (id: number) => api("DELETE", `/files/${id}`),
  retryFile: (id: number) => api("POST", `/files/${id}/retry`),
  share: (id: number, enabled: boolean) => api<{ shareUrl: string | null }>("POST", `/files/${id}/share`, { enabled }),
};
