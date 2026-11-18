"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconCheck, IconCopy, IconRefresh } from "./icons";
import { deadlineLevel, followupDeadline, type DeadlineLevel } from "@/lib/today";

/** เรียก API ของแอดมิน — โยน Error พร้อมข้อความไทยจากเซิร์ฟเวอร์ */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "เกิดข้อผิดพลาดที่ไม่รู้สาเหตุ";
    throw new Error(message);
  }
  return json as T;
}

/** โหลดข้อมูลครั้งแรก + มีปุ่มโหลดใหม่ (โหลดซ้ำไม่ล้างข้อมูลเดิม จอไม่กระพริบว่าง) */
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

// ── หัวหน้า + สถานะของหน้า ──────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
  stackActions = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** ปุ่มมีข้อความยาว (เช่น "เพิ่มคำถาม") → บนมือถือให้ลงบรรทัดใหม่ ไม่บีบคำอธิบาย */
  stackActions?: boolean;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className={stackActions ? "w-full min-w-0 sm:w-auto sm:flex-1" : "min-w-0 flex-1"}>
        <h1 className="text-[1.6rem] font-semibold">{title}</h1>
        {subtitle && <p className="soft mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn-quiet btn-sm" onClick={onClick} disabled={busy} aria-label="โหลดใหม่">
      <IconRefresh size={18} className={busy ? "animate-spin" : ""} />
      <span className="hidden sm:inline">โหลดใหม่</span>
    </button>
  );
}

export function Loading({ label = "กำลังโหลด...", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-4">
          <div className="skeleton mb-2 h-4 w-1/3" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function Empty({ label, hint, action }: { label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card-quiet px-5 py-8 text-center">
      <p className="font-medium">{label}</p>
      {hint && <p className="soft mt-1 text-[0.95rem]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="card flex flex-wrap items-start gap-3 p-4"
      style={{ borderColor: "var(--red-line)", background: "var(--red-soft)" }}
    >
      <span style={{ color: "var(--red)" }} className="mt-0.5">
        <IconAlert />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium" style={{ color: "var(--red)" }}>
          มีบางอย่างผิดพลาด
        </p>
        <p className="text-[0.95rem]">{message}</p>
      </div>
      {onRetry && (
        <button className="btn-quiet btn-sm" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

/** แจ้งผลสั้น ๆ หลังกดบันทึก (โปรแกรมอ่านจอได้ยินด้วย) */
export function Notice({ tone = "ok", children }: { tone?: "ok" | "warn"; children: React.ReactNode }) {
  const c = tone === "ok" ? "var(--teal)" : "var(--amber)";
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 font-medium" style={{ color: c }}>
      {tone === "ok" ? <IconCheck size={18} /> : <IconAlert size={18} />}
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-medium">{label}</span>
      {hint && <span className="soft mb-1.5 block text-[0.9rem]">{hint}</span>}
      {children}
    </label>
  );
}

export function Section({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card space-y-4 p-5 ${className}`}>
      {(title || description) && (
        <div>
          {title && <h2 className="text-[1.15rem] font-semibold">{title}</h2>}
          {description && <p className="soft mt-0.5 text-[0.95rem]">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

// ── ป้ายสถานะ (ภาษาไทยทั้งหมด) ─────────────────────────────────────────

export const STATE_LABEL: Record<string, string> = {
  bot_active: "บอตดูแลอยู่",
  collecting_lead: "บอตกำลังถามข้อมูล",
  awaiting_human: "รอคนตอบ",
  human_active: "ต้นคุยอยู่",
  closed: "ปิดแล้ว",
};

const STATE_CHIP: Record<string, string> = {
  bot_active: "chip",
  collecting_lead: "chip chip-blue",
  awaiting_human: "chip chip-red",
  human_active: "chip chip-teal",
  closed: "chip",
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={STATE_CHIP[state] ?? "chip"}>
      <span className="dot" aria-hidden="true" />
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "ยังไม่ได้ติดต่อ",
  contacted: "ติดต่อแล้ว",
  won: "ปิดได้",
  lost: "ไม่ไปต่อ",
};

const LEAD_STATUS_CHIP: Record<string, string> = {
  new: "chip chip-gold",
  contacted: "chip chip-blue",
  won: "chip chip-teal",
  lost: "chip",
};

export function LeadStatusBadge({ status }: { status: string }) {
  return <span className={LEAD_STATUS_CHIP[status] ?? "chip"}>{LEAD_STATUS_LABEL[status] ?? status}</span>;
}

/** กลุ่มจากปุ่มแอด (ตรงกับ lib/qualifier.ts) */
export const SEGMENT_LABEL: Record<string, string> = {
  big: "ธุรกิจ 10 ล้านขึ้นไป",
  small: "ธุรกิจต่ำกว่า 10 ล้าน",
  self_learn: "อยากเรียนเอง",
  details: "ขอตัวอย่างงาน",
  open: "ทักเอง (ยังไม่รู้ยอดขาย)",
};

export function SegmentChip({ segment }: { segment: string | null }) {
  if (!segment) return null;
  return <span className="chip">{SEGMENT_LABEL[segment] ?? segment}</span>;
}

/** ช่องที่บอตเก็บได้ (ตรงกับ FIELD_LABEL ใน lib/qualifier.ts + ชื่อเก่าของรอบ 1.1) */
export const FIELD_LABEL: Record<string, string> = {
  task: "อยากให้ AI ช่วยงาน",
  pain: "ตรงไหนกินเวลา",
  business_type: "ธุรกิจ",
  use_case: "อยากใช้ AI กับงาน",
  format: "รูปแบบเรียน",
  slot: "เวลานัดที่เลือก",
  team_size: "ขนาดทีม",
  decision_maker: "ตัดสินใจ",
  timeline: "อยากเห็นผล",
};

// ── เวลา ─────────────────────────────────────────────────────────────

export function thaiTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function thaiDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

/** "5 นาทีที่แล้ว" · "3 ชม.ที่แล้ว" · "2 วันที่แล้ว" — อ่านเร็วกว่าวันเวลาเต็ม */
export function relTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  return `${d} วันที่แล้ว`;
}

/** เวลาที่เหลือก่อนถึงกำหนด เช่น "เหลือ 1 วัน 4 ชม." */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "เลยกำหนดแล้ว";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `เหลือ ${Math.max(1, Math.round(ms / 60_000))} นาที`;
  if (h < 24) return `เหลือ ${h} ชม.`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `เหลือ ${d} วัน ${rem} ชม.` : `เหลือ ${d} วัน`;
}

/** ป้ายกำหนดส่งร่างรอบ 2 — ขึ้นสีเฉพาะเมื่อเหลือ ≤ 2 วัน (ที่เหลือเป็นป้ายเงียบ) */
export function DeadlineBadge({
  deadline,
  level,
  quietWhenOk = false,
}: {
  deadline: string | null;
  level: DeadlineLevel;
  quietWhenOk?: boolean;
}) {
  if (!deadline || level === "none") return null;
  if (level === "expired") return <span className="chip">ร่างรอบ 2 เลยกำหนดแล้ว</span>;
  if (level === "ok") {
    if (quietWhenOk) return null;
    return <span className="chip">ร่างรอบ 2 · ส่งได้ถึง {thaiDate(deadline)}</span>;
  }
  return (
    <span className="chip chip-amber">
      <span className="dot" aria-hidden="true" />
      ส่งร่างรอบ 2 · {timeLeft(deadline)}
    </span>
  );
}

export function draftDeadline(lastUserMessageAt: string | null, now = new Date()) {
  const d = followupDeadline(lastUserMessageAt);
  return { deadline: d ? d.toISOString() : null, level: deadlineLevel(d, now) };
}

// ── คัดลอก ───────────────────────────────────────────────────────────

/** คัดลอกลงคลิปบอร์ด — บางเบราว์เซอร์/หน้าต่างฝังไม่ให้ใช้ clipboard API → ถอยไปวิธีเก่า */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "คัดลอก",
  className = "btn-quiet btn-sm",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"" | "ok" | "manual">("");
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "manual");
        setTimeout(() => setState(""), 2500);
      }}
      aria-live="polite"
    >
      {state === "ok" ? <IconCheck size={18} /> : <IconCopy size={18} />}
      {state === "ok" ? "คัดลอกแล้ว" : state === "manual" ? "คัดลอกไม่ได้ — ลากเลือกเอง" : label}
    </button>
  );
}

// ── ที่มาของคำตอบ ────────────────────────────────────────────────────

/** ป้ายบอกว่าคำตอบนี้มาจากไหน — ช่วยดูว่าบอตคิดยังไง */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith("rule:")) return `กติกา: ${source.slice(5)}`;
  if (source === "faq") return "คำถามที่ถามบ่อย";
  if (source === "kb_ai") return "ฐานความรู้ + AI";
  if (source === "handoff") return "โอนหาคน";
  if (source === "admin") return "แอดมินพิมพ์เอง";
  if (source.startsWith("lead:")) return "ขั้นตอนเก็บข้อมูล";
  if (source.startsWith("qualifier:")) return "คัดลูกค้าจากแอด";
  if (source === "lead_summary") return "สรุปผู้สนใจ (ลูกค้าไม่เห็น)";
  if (source.startsWith("followup:")) return "ตามต่ออัตโนมัติ";
  if (source === "handoff_pre") return "ก่อนโอนหาคน";
  return source;
}

export function SourceTag({ source }: { source: string | null }) {
  const label = sourceLabel(source);
  if (!label) return null;
  return <span className="soft text-[0.82rem]">{label}</span>;
}

// ── ช่องทางติดต่อของผู้สนใจ ────────────────────────────────────────────

export interface ContactBits {
  phone: string | null;
  email: string | null;
  line_id: string | null;
}

export function contactText(l: ContactBits): string {
  return [l.phone, l.email, l.line_id && `LINE ${l.line_id}`].filter(Boolean).join(" · ");
}

/** ปุ่มโทร/อีเมล/คัดลอก LINE — ใหญ่พอกดด้วยนิ้ว */
export function ContactActions({ lead }: { lead: ContactBits }) {
  if (!lead.phone && !lead.email && !lead.line_id) return <span className="soft">ยังไม่ได้ช่องทางติดต่อ</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {lead.phone && (
        <a className="btn-quiet btn-sm" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
          โทร {lead.phone}
        </a>
      )}
      {lead.email && (
        <a className="btn-quiet btn-sm" href={`mailto:${lead.email}`}>
          {lead.email}
        </a>
      )}
      {lead.line_id && <CopyButton text={lead.line_id} label={`LINE ${lead.line_id}`} />}
    </div>
  );
}
