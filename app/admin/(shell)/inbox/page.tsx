"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconSearch } from "@/components/icons";
import {
  DeadlineBadge,
  draftDeadline,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  RefreshButton,
  relTime,
  StateBadge,
  useLoad,
} from "@/components/ui";

interface Conversation {
  id: string;
  name: string;
  state: string;
  unread: boolean;
  lastMessage: string;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  lastUserMessageAt: string | null;
  hasDraft?: boolean;
}

type FilterKey = "need" | "unread" | "all" | "human_active" | "bot" | "closed";

/** "ต้องตอบ" = รอคนตอบ หรือ ต้นถือสายอยู่แต่ลูกค้าพิมพ์มาล่าสุด (เกณฑ์เดียวกับหน้างานวันนี้) */
const needsReply = (c: Conversation) =>
  c.state === "awaiting_human" || (c.state === "human_active" && c.lastMessageSender === "user");

const FILTERS: { key: FilterKey; label: string; test: (c: Conversation) => boolean }[] = [
  { key: "need", label: "ต้องตอบ", test: needsReply },
  { key: "unread", label: "ยังไม่อ่าน", test: (c) => c.unread },
  { key: "all", label: "ทั้งหมด", test: () => true },
  { key: "human_active", label: "ต้นคุยอยู่", test: (c) => c.state === "human_active" },
  { key: "bot", label: "บอตดูแล", test: (c) => c.state === "bot_active" || c.state === "collecting_lead" },
  { key: "closed", label: "ปิดแล้ว", test: (c) => c.state === "closed" },
];

const SENDER: Record<string, string> = { user: "ลูกค้า", bot: "บอต", admin: "ต้น", system: "ระบบ" };

export default function InboxPage() {
  // ดึงทั้งหมดครั้งเดียวแล้วกรองในเครื่อง — จะได้นับจำนวนบนแท็บได้ทุกแท็บ และสลับแท็บไม่ต้องรอ
  const { data, error, loading, reload } = useLoad<{ items: Conversation[] }>("/api/admin/conversations?limit=200");
  const [filter, setFilter] = useState<FilterKey>("need");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, items.filter(f.test).length])) as Record<FilterKey, number>,
    [items],
  );

  // ครั้งแรก ถ้าไม่มีแชทต้องตอบเลย ให้เปิดแท็บทั้งหมดแทน จะได้ไม่เจอจอว่าง
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (data && !picked) {
      setPicked(true);
      if (counts.need === 0) setFilter("all");
    }
  }, [data, picked, counts.need]);

  const active = FILTERS.find((f) => f.key === filter)!;
  const term = q.trim().toLowerCase();
  const shown = items
    .filter(active.test)
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.lastMessage.toLowerCase().includes(term));

  return (
    <div>
      <PageHeader
        title="กล่องข้อความ"
        subtitle="แชทจาก Messenger ของเพจ · เปิดแชทแล้วถือว่าอ่านแล้ว"
        actions={<RefreshButton onClick={reload} busy={loading} />}
      />

      <div className="mb-4 space-y-3">
        <div className="tabs" role="toolbar" aria-label="กรองแชท">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="tab" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              {data && <span className="count">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">ค้นหาชื่อหรือข้อความ</span>
          <span className="soft pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
            <IconSearch size={18} />
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือข้อความ" style={{ paddingLeft: "2.4rem" }} />
        </label>
      </div>

      {loading && !data && <Loading rows={5} />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && shown.length === 0 && (
        <Empty
          label={term ? `ไม่พบ “${q}” ในแท็บ${active.label}` : filter === "need" ? "ไม่มีแชทที่ต้องตอบตอนนี้" : "ยังไม่มีแชทในแท็บนี้"}
          hint={items.length === 0 ? "เมื่อมีคนทักเพจครั้งแรก แชทจะขึ้นตรงนี้" : undefined}
        />
      )}

      {shown.length > 0 && (
        <ul className="card divide-y overflow-hidden" style={{ borderColor: "var(--line)" }}>
          {shown.map((c) => {
            const dl = c.hasDraft ? draftDeadline(c.lastUserMessageAt, new Date(now)) : null;
            return (
              <li key={c.id} style={{ borderColor: "var(--line)" }}>
                <Link
                  href={`/admin/inbox/${c.id}`}
                  className="row-link flex gap-3 px-4 py-3.5"
                  style={c.unread ? { background: "var(--gold-soft)" } : undefined}
                >
                  <span className="mt-2.5 w-2.5 flex-none" aria-hidden="true">
                    {c.unread && <span className="dot" style={{ color: "var(--g2)", width: 10, height: 10 }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={c.unread ? "font-bold" : "font-medium"}>{c.name}</span>
                      {c.unread && <span className="sr-only">(ยังไม่ได้อ่าน)</span>}
                      <StateBadge state={c.state} />
                      {dl && <DeadlineBadge deadline={dl.deadline} level={dl.level} quietWhenOk />}
                      <span className="soft tnum ml-auto text-[0.88rem]" title="เวลาที่ลูกค้าพิมพ์ล่าสุด">
                        {relTime(c.lastUserMessageAt ?? c.lastMessageAt, now)}
                      </span>
                    </div>
                    <p className={`mt-0.5 line-clamp-1 ${c.unread ? "" : "soft"}`}>
                      {c.lastMessageSender && <span className="soft">{SENDER[c.lastMessageSender] ?? ""}: </span>}
                      {c.lastMessage || "—"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <p className="soft mt-3 text-[0.85rem]">เวลาทางขวา = นานแค่ไหนแล้วที่ลูกค้าพิมพ์ล่าสุด · ป้ายส้มขึ้นเมื่อร่างรอบ 2 เหลือเวลาส่งไม่เกิน 2 วัน</p>
      )}
    </div>
  );
}
