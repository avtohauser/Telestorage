// Минимальные типы для Telegram.WebApp (https://core.telegram.org/bots/webapps)
interface PopupButton {
  id?: string;
  type?: "default" | "ok" | "close" | "cancel" | "destructive";
  text?: string;
}

interface WebApp {
  initData: string;
  version: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb?: (ok: boolean) => void): void;
  showPopup(params: { title?: string; message: string; buttons?: PopupButton[] }, cb?: (id: string) => void): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void };
  onEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : undefined;

export function haptic(type: "success" | "error" | "light") {
  try {
    if (type === "light") tg?.HapticFeedback?.impactOccurred("light");
    else tg?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* старые клиенты */
  }
}

export function alertMsg(message: string) {
  if (tg && tg.isVersionAtLeast("6.2")) tg.showAlert(message);
  else window.alert(message);
}

export function confirmMsg(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg && tg.isVersionAtLeast("6.2")) tg.showConfirm(message, (ok) => resolve(ok));
    else resolve(window.confirm(message));
  });
}

export function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

export function downloadUrl(path: string, name: string) {
  const url = absoluteUrl(path + (path.includes("?") ? "&" : "?") + "download=1");
  if (tg?.downloadFile && tg.isVersionAtLeast("8.0")) {
    tg.downloadFile({ url, file_name: name });
  } else if (tg) {
    tg.openLink(url);
  } else {
    window.open(url, "_blank");
  }
}

/** Тема avr по colorScheme Telegram; шапку и фон Telegram красим в цвет «земли». */
export function applyTheme() {
  const set = () => {
    const scheme = tg?.colorScheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", scheme);
    const ground = scheme === "dark" ? "#0B4248" : "#E9EFEF";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ground);
    try {
      if (tg?.isVersionAtLeast("6.1")) {
        tg.setHeaderColor?.(ground);
        tg.setBackgroundColor?.(ground);
      }
      if (tg?.isVersionAtLeast("7.10")) tg.setBottomBarColor?.(ground);
    } catch {
      /* старые клиенты */
    }
  };
  set();
  tg?.onEvent("themeChanged", set);
}
