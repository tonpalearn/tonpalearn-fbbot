"use client";

import { useCallback, useEffect, useState } from "react";

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

/** โหลดข้อมูลครั้งแรก + มีปุ่มโหลดใหม่ */
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

export function Loading({ label = "กำลังโหลด..." }: { label?: string }) {
  return <p className="soft py-8 text-center">{label}</p>;
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="soft">{label}</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="card p-4"
      style={{ borderColor: "var(--accent)", background: "var(--accent-weak)" }}
    >
      <p className="mb-2 font-medium">มีบางอย่างผิดพลาด</p>
      <p className="text-[0.95rem]">{message}</p>
      {onRetry && (
        <button className="btn-quiet mt-3" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-medium">{label}</span>
      {hint && <span className="soft mb-1 block text-[0.9rem]">{hint}</span>}
      {children}
    </label>
  );
}

const STATE_LABEL: Record<string, string> = {
  bot_active: "บอตดูแลอยู่",
  collecting_lead: "กำลังเก็บข้อมูล",
  awaiting_human: "รอคนมารับ",
  human_active: "คนกำลังคุย",
  closed: "ปิดแล้ว",
};

const STATE_COLOR: Record<string, string> = {
  bot_active: "var(--ok, #2f7d5d)",
  collecting_lead: "#b4691a",
  awaiting_human: "#b3382f",
  human_active: "#2f5fb3",
  closed: "var(--text-soft)",
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      className="inline-block rounded-full px-3 py-0.5 text-[0.85rem] font-medium"
      style={{ background: "var(--accent-weak)", color: STATE_COLOR[state] ?? "var(--text)" }}
    >
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

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

/** ป้ายบอกว่าคำตอบนี้มาจากไหน — ช่วยดูว่าบอตคิดยังไง */
export function SourceTag({ source }: { source: string | null }) {
  if (!source) return null;
  const label = source.startsWith("rule:")
    ? `กติกา: ${source.slice(5)}`
    : source === "faq"
      ? "คำถามที่ถามบ่อย"
      : source === "kb_ai"
        ? "ฐานความรู้ + AI"
        : source === "handoff"
          ? "โอนหาคน"
          : source === "admin"
            ? "แอดมินพิมพ์เอง"
            : source.startsWith("lead:")
              ? "ขั้นตอนเก็บข้อมูล"
              : source;
  return <span className="soft text-[0.8rem]">{label}</span>;
}
