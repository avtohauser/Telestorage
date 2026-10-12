import { useEffect, useMemo, useState } from "react";
import { Api, type FolderItem } from "../api";
import { Loader } from "../brand";
import { Icon } from "./Icon";
import { Overlay } from "./Sheet";

/** Выбор папки назначения. exclude — папка, которую перемещаем (её поддерево скрывается). */
export function MovePicker({ exclude, onPick, onClose }: { exclude?: number; onPick: (folderId: number | null) => void; onClose: () => void }) {
  const [folders, setFolders] = useState<FolderItem[] | null>(null);
  useEffect(() => {
    Api.allFolders().then((r) => setFolders(r.folders), () => setFolders([]));
  }, []);

  const rows = useMemo(() => {
    if (!folders) return [];
    const byParent = new Map<number | null, FolderItem[]>();
    for (const f of folders) {
      const k = f.parentId ?? null;
      byParent.set(k, [...(byParent.get(k) || []), f]);
    }
    const out: { f: FolderItem; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const f of byParent.get(parent) || []) {
        if (f.id === exclude) continue;
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders, exclude]);

  const pick = (id: number | null) => {
    onClose();
    onPick(id);
  };

  return (
    <Overlay onClose={onClose}>
      <div className="sheet-head">
        <div className="avr-title">Куда переместить</div>
      </div>
      <div className="sheet-actions picker">
        <button className="sheet-btn" onClick={() => pick(null)}>
          <Icon name="home" />
          Мои файлы
        </button>
        {folders === null && <Loader />}
        {rows.map(({ f, depth }) => (
          <button key={f.id} className="sheet-btn" style={{ paddingLeft: 20 + depth * 20 }} onClick={() => pick(f.id)}>
            <Icon name="folder" />
            <span className="ellipsis">{f.name}</span>
          </button>
        ))}
      </div>
    </Overlay>
  );
}
