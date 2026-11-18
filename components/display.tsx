"use client";

/**
 * แผง "การแสดงผล" — โหมดสี 3 ทาง (ตามเครื่อง · สว่าง · มืด) + ขนาดตัวอักษร 3 ระดับ (ก ก ก)
 * เก็บเป็น object เดียวใน localStorage คีย์ fbchat_look · ใส่ก่อนวาดหน้าโดยสคริปต์ใน app/layout.tsx
 * ปุ่มสลับโหมดเร็วบนแถบบนยังอยู่ แยกจากแผง (ตาม feedback_metatron_theme_toggle)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconDisplay, IconMonitor, IconMoon, IconSun, IconX } from "./icons";

export type ThemeMode = "system" | "light" | "dark";
export type TextSize = "sm" | "md" | "lg";
export interface Look {
  theme: ThemeMode;
  size: TextSize;
}

const KEY = "fbchat_look";
const DEFAULT_LOOK: Look = { theme: "system", size: "md" };

function readLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    const l = raw ? (JSON.parse(raw) as Partial<Look>) : {};
    if (!raw) {
      const old = localStorage.getItem("fbchat_theme"); // ค่าจากปุ่มรุ่นเก่า
      if (old === "light" || old === "dark") l.theme = old;
    }
    return {
      theme: l.theme === "light" || l.theme === "dark" ? l.theme : "system",
      size: l.size === "sm" || l.size === "lg" ? l.size : "md",
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

function applyLook(l: Look) {
  const d = document.documentElement;
  if (l.theme === "system") d.removeAttribute("data-theme");
  else d.setAttribute("data-theme", l.theme);
  if (l.size === "md") d.removeAttribute("data-size");
  else d.setAttribute("data-size", l.size);
  // แถบเบราว์เซอร์มือถือให้สีตามโหมดที่เลือก
  const dark =
    l.theme === "dark" || (l.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", dark ? "#0C0E13" : "#F7F6F2");
  });
  try {
    if (l.theme === "system" && l.size === "md") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(l));
    localStorage.removeItem("fbchat_theme");
  } catch {
    // โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ — ใช้ได้แค่รอบนี้ ไม่เป็นไร
  }
  window.dispatchEvent(new CustomEvent("fbchat-look", { detail: l }));
}

export function useLook() {
  const [look, setLookState] = useState<Look>(DEFAULT_LOOK);
  useEffect(() => {
    setLookState(readLook());
    const on = (e: Event) => setLookState((e as CustomEvent<Look>).detail);
    window.addEventListener("fbchat-look", on);
    return () => window.removeEventListener("fbchat-look", on);
  }, []);
  const setLook = useCallback((next: Look) => {
    setLookState(next);
    applyLook(next);
  }, []);
  return { look, setLook };
}

const THEMES: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
  { value: "system", label: "ตามเครื่อง", Icon: IconMonitor },
  { value: "light", label: "สว่าง", Icon: IconSun },
  { value: "dark", label: "มืด", Icon: IconMoon },
];

const SIZES: { value: TextSize; label: string; px: string }[] = [
  { value: "sm", label: "เล็ก", px: "0.95rem" },
  { value: "md", label: "กลาง", px: "1.15rem" },
  { value: "lg", label: "ใหญ่", px: "1.4rem" },
];

/** ปุ่มสลับเร็ว: ตามเครื่อง → สว่าง → มืด */
export function ThemeQuickToggle({ className = "" }: { className?: string }) {
  const { look, setLook } = useLook();
  const idx = THEMES.findIndex((t) => t.value === look.theme);
  const cur = THEMES[idx < 0 ? 0 : idx];
  const next = THEMES[(idx + 1) % THEMES.length];
  return (
    <button
      type="button"
      className={`btn-ghost px-2.5 ${className}`}
      onClick={() => setLook({ ...look, theme: next.value })}
      aria-label={`โหมดสี: ${cur.label} — กดเพื่อเปลี่ยนเป็น${next.label}`}
      title={`โหมดสี: ${cur.label}`}
    >
      <cur.Icon />
    </button>
  );
}

/** ปุ่มเปิดแผงการแสดงผล + ตัวแผง (ล่างจอบนมือถือ · กลางจอบนจอใหญ่) */
export function DisplayPanelButton({ variant = "row" }: { variant?: "row" | "icon" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "icon" ? (
        <button type="button" className="btn-ghost px-2.5" onClick={() => setOpen(true)} aria-label="การแสดงผล">
          <IconDisplay />
        </button>
      ) : (
        <button type="button" className="btn-ghost w-full justify-start gap-3" onClick={() => setOpen(true)}>
          <IconDisplay /> การแสดงผล
        </button>
      )}
      {open && <DisplayPanel onClose={() => setOpen(false)} />}
    </>
  );
}

export function DisplayPanel({ onClose }: { onClose: () => void }) {
  const { look, setLook } = useLook();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // วาดที่ <body> — ถ้าอยู่ในแถบบน (sticky z-30) แผงจะโดนแถบแท็บล่างทับ
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="look-title"
        className="card pb-safe w-full max-w-md space-y-5 rounded-b-none p-5 sm:rounded-b-2xl"
        style={{ boxShadow: "var(--shadow-m)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="look-title" className="text-lg font-semibold">
            การแสดงผล
          </h2>
          <button type="button" className="btn-ghost px-2.5" onClick={onClose} aria-label="ปิด">
            <IconX />
          </button>
        </div>

        <fieldset>
          <legend className="mb-2 font-medium">โหมดสี</legend>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => {
              const on = look.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLook({ ...look, theme: t.value })}
                  className="card-quiet flex min-h-[76px] flex-col items-center justify-center gap-1 px-2 py-3"
                  style={on ? { borderColor: "var(--gold-line)", background: "var(--gold-soft)", color: "var(--gold)" } : undefined}
                >
                  <t.Icon size={22} />
                  <span className="font-medium">{t.label}</span>
                </button>
              );
            })}
          </div>
          <p className="soft mt-2 text-[0.88rem]">“ตามเครื่อง” = สว่างหรือมืดตามที่ตั้งไว้ในมือถือ/คอมพิวเตอร์</p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">ขนาดตัวอักษร</legend>
          <div className="grid grid-cols-3 gap-2">
            {SIZES.map((s) => {
              const on = look.size === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLook({ ...look, size: s.value })}
                  className="card-quiet flex min-h-[76px] flex-col items-center justify-center gap-0.5 px-2 py-2"
                  style={on ? { borderColor: "var(--gold-line)", background: "var(--gold-soft)", color: "var(--gold)" } : undefined}
                >
                  <span className="f-head font-semibold" style={{ fontSize: s.px, lineHeight: 1.3 }}>
                    ก
                  </span>
                  <span className="text-[0.88rem]">{s.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="card-quiet space-y-1 p-3">
          <p className="soft text-[0.85rem]">ตัวอย่าง</p>
          <p className="font-medium">ธนพล · กดปุ่ม “100 ล้านขึ้นไป”</p>
          <p className="soft">ต้องรวมยอดขายจากหลายสาขาทุกเช้า ใช้คน 2 คนครึ่งวัน</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <button type="button" className="btn-quiet" onClick={() => setLook(DEFAULT_LOOK)}>
            คืนค่าเริ่มต้น
          </button>
          <button type="button" className="btn-gold" onClick={onClose}>
            <IconCheck size={18} /> เสร็จ
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
