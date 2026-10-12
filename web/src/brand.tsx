import { type CSSProperties, useEffect, useId, useRef } from "react";

export const STAR_PATH = "M50 2C53 30 70 47 98 50C70 53 53 70 50 98C47 70 30 53 2 50C30 47 47 30 50 2Z";
// Дополнение avr cloud: облако (внешняя часть, фиолетовая) и стрелка загрузки (внутренняя, розовая)
const CLOUD = "M115.3 62.8H129.7A8 8 0 0 0 131.3 47A10.4 10.4 0 0 0 111.6 45.2A8.8 8.8 0 0 0 115.3 62.8Z";
const ARROW = "M122.5 58.5V48.5M118.3 52.7L122.5 48.5L126.7 52.7";

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function Gradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stopColor="#F2A5C3" />
      <stop offset="1" stopColor="#5A4FC8" />
    </linearGradient>
  );
}

/** Звезда avr с градиентом. */
export function Star({ size = 24, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  const id = useId();
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs><Gradient id={id} /></defs>
      <path fill={`url(#${id})`} d={STAR_PATH} />
    </svg>
  );
}

/** Знак продукта: звезда и облако. Меньше 32 px — только звезда (по брендбуку). busy — стрелка «поднимается», пока идёт загрузка. */
export function Sign({ height = 40, busy = false, className }: { height?: number; busy?: boolean; className?: string }) {
  const id = useId();
  if (height < 32) return <Star size={height} className={className} />;
  return (
    <svg className={`${className ?? ""}${busy ? " sign-busy" : ""}`} height={height} width={(height * 140) / 100} viewBox="0 0 140 100" aria-hidden="true">
      <defs><Gradient id={id} /></defs>
      <path fill={`url(#${id})`} d={STAR_PATH} />
      <path d={CLOUD} fill="none" stroke="#5A4FC8" strokeWidth="6" strokeLinejoin="round" />
      <path className="sign-arrow" d={ARROW} fill="none" stroke="#F2A5C3" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="avr-word" style={{ fontSize: size }}>
      avr<i>cloud</i>
    </span>
  );
}

/** Лоадер-звезда: появляется, только если ждём дольше 0.4 с. */
export function Loader({ label }: { label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.classList.add("shown"), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div ref={ref} className="loader" role="status" aria-label={label || "Загрузка"}>
      <i className="avr-star avr-star-loader" />
      {label && <div className="avr-body-sm avr-muted">{label}</div>}
    </div>
  );
}

const starShape = typeof Path2D === "function" ? new Path2D(STAR_PATH) : null;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Звёздное поле (порт starfield() из avr.js): фон экрана входа. Возвращает функцию остановки. */
export function starfield(host: HTMLElement, { density = 1.1, stars = 0.08, drift = 6 } = {}) {
  host.classList.add("avr-starfield-host");
  const canvas = document.createElement("canvas");
  canvas.className = "avr-starfield";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d")!;
  let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
  let colors = { point: "#D3E3E4", stars: ["#F2A5C3", "#5A4FC8", "#D3E3E4"], a: 1 };
  type Item = { x: number; y: number; z: number; r: number; star: boolean; c: number; phase: number; speed: number; turn: number };
  let items: Item[] = [];

  const palette = () => {
    const dark = parseInt((css("--background") || "#0B4248").slice(1, 3), 16) < 128;
    colors = dark
      ? { point: "#D3E3E4", stars: ["#F2A5C3", "#5A4FC8", "#D3E3E4"], a: 1 }
      : { point: "#0B4248", stars: ["#5A4FC8", "#F2A5C3", "#0B4248"], a: 0.55 };
  };
  const seed = () => {
    const n = Math.round(((w * h) / 10000) * density);
    items = Array.from({ length: n }, (_, i) => {
      const star = Math.random() < stars;
      return {
        x: Math.random() * w, y: Math.random() * h, z: 0.3 + Math.random() * 0.7,
        r: star ? 6 + Math.random() * 12 : 0.6 + Math.random() * 1.1,
        star, c: i % 3, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 1.4, turn: Math.random() * 0.6,
      };
    });
  };
  const draw = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const moving = !still();
    for (const s of items) {
      const y = moving ? (((s.y - (t / 1000) * drift * s.z) % h) + h) % h : s.y;
      const tw = moving ? 0.55 + 0.45 * Math.sin((t / 1000) * s.speed + s.phase) : 0.8;
      if (s.star && starShape) {
        const k = (s.r / 100) * (0.75 + 0.25 * tw);
        ctx.save();
        ctx.translate(s.x, y);
        ctx.rotate(moving ? Math.sin(t / 3000 + s.phase) * s.turn : 0);
        ctx.scale(k, k);
        ctx.translate(-50, -50);
        ctx.globalAlpha = (0.35 + 0.55 * tw) * colors.a;
        ctx.fillStyle = colors.stars[s.c];
        ctx.fill(starShape);
        ctx.restore();
      } else {
        ctx.globalAlpha = (0.15 + 0.45 * tw * s.z) * colors.a;
        ctx.fillStyle = colors.point;
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
  const size = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    seed();
    draw(performance.now());
  };
  const loop = (t: number) => {
    raf = 0;
    if (document.hidden) return;
    if (t - last > 30) {
      draw(t);
      last = t;
    }
    if (!still()) raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const ro = new ResizeObserver(size);
  ro.observe(host);
  const mo = new MutationObserver(() => {
    palette();
    draw(performance.now());
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("visibilitychange", wake);
  palette();
  size();
  wake();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    mo.disconnect();
    document.removeEventListener("visibilitychange", wake);
    canvas.remove();
  };
}

export function useStarfield<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => (ref.current ? starfield(ref.current) : undefined), []);
  return ref;
}
