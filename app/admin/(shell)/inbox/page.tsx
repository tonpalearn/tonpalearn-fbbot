"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorBox, Loading, StateBadge, thaiTime, useLoad } from "@/components/ui";

interface Conversation {
  id: string;
  name: string;
  state: string;
  unread: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
}

const FILTERS = [
  { value: "", label: "ทั้งหมด" },
  { value: "bot_active", label: "บอตดูแลอยู่" },
  { value: "collecting_lead", label: "กำลังเก็บข้อมูล" },
  { value: "awaiting_human", label: "รอคนมารับ" },
  { value: "human_active", label: "คนกำลังคุย" },
];

export default function InboxPage() {
  const [state, setState] = useState("");
  const path = `/api/admin/conversations?limit=100${state ? `&state=${state}` : ""}`;
  const { data, error, loading, reload } = useLoad<{ items: Conversation[] }>(path);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">กล่องข้อความ</h1>
        <button className="btn-quiet ml-auto" onClick={reload}>
          โหลดใหม่
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setState(f.value)}
            className={state === f.value ? "btn-gold" : "btn-quiet"}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty label="ยังไม่มีบทสนทนาในหมวดนี้ครับ" />
      )}

      <div className="space-y-2">
        {data?.items.map((c) => (
          <Link
            key={c.id}
            href={`/admin/inbox/${c.id}`}
            className="card block p-4 hover:bg-[var(--accent-weak)]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{c.name}</span>
              <StateBadge state={c.state} />
              {c.unread && (
                <span className="text-[0.85rem]" style={{ color: "var(--accent)" }}>
                  ● ยังไม่ได้อ่าน
                </span>
              )}
              <span className="soft ml-auto text-[0.85rem]">{thaiTime(c.lastMessageAt)}</span>
            </div>
            <p className="soft mt-1 line-clamp-2">{c.lastMessage || "—"}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
