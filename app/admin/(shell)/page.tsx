"use client";

import Link from "next/link";
import { Empty, ErrorBox, Loading, StateBadge, thaiTime, useLoad } from "@/components/ui";

interface Stats {
  messagesToday: number;
  unreadConversations: number;
  newLeadsThisWeek: number;
  aiCallsToday: number;
  aiCallCap: number;
  answerMix: { rule: number; faq: number; ai: number; handoff: number; admin: number; other: number };
  answerMixDays: number;
}

interface Conversation {
  id: string;
  name: string;
  state: string;
  unread: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
}

const MIX_LABEL: Record<string, string> = {
  rule: "กติกา",
  faq: "คำถามที่ถามบ่อย",
  ai: "ฐานความรู้ + AI",
  handoff: "โอนหาคน",
  admin: "แอดมินพิมพ์เอง",
  other: "อื่น ๆ",
};

export default function DashboardPage() {
  const stats = useLoad<Stats>("/api/admin/stats");
  const convos = useLoad<{ items: Conversation[] }>("/api/admin/conversations?limit=10");

  return (
    <div className="space-y-7">
      <h1 className="text-2xl font-semibold">ภาพรวม</h1>

      {stats.loading && <Loading />}
      {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}

      {stats.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="ข้อความวันนี้" value={stats.data.messagesToday} />
            <Metric label="แชทที่ยังไม่ได้อ่าน" value={stats.data.unreadConversations} />
            <Metric label="ผู้สนใจใหม่ 7 วัน" value={stats.data.newLeadsThisWeek} />
            <Metric
              label="เรียกโมเดลวันนี้"
              value={`${stats.data.aiCallsToday} / ${stats.data.aiCallCap}`}
              warn={stats.data.aiCallsToday >= stats.data.aiCallCap * 0.8}
            />
          </div>

          <section className="card p-5">
            <h2 className="mb-1 text-lg font-semibold">คำตอบมาจากไหนบ้าง</h2>
            <p className="soft mb-4 text-[0.9rem]">
              ย้อนหลัง {stats.data.answerMixDays} วัน — ยิ่งกติกากับคำถามที่ถามบ่อยตอบได้มาก
              ค่าโมเดลยิ่งถูก
            </p>
            <MixBar mix={stats.data.answerMix} />
          </section>
        </>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">บทสนทนาล่าสุด</h2>
          <Link href="/admin/inbox" className="btn-quiet">
            ดูทั้งหมด
          </Link>
        </div>

        {convos.loading && <Loading />}
        {convos.error && <ErrorBox message={convos.error} onRetry={convos.reload} />}
        {convos.data && convos.data.items.length === 0 && (
          <Empty label="ยังไม่มีใครทักเข้ามา — เมื่อมีข้อความแรก จะขึ้นตรงนี้ครับ" />
        )}

        <div className="space-y-2">
          {convos.data?.items.map((c) => (
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
              <p className="soft mt-1 line-clamp-1">{c.lastMessage || "—"}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="soft text-[0.9rem]">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold"
        style={warn ? { color: "#b4691a" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function MixBar({ mix }: { mix: Record<string, number> }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="soft">ยังไม่มีข้อความที่บอตตอบออกไป</p>;

  const colors: Record<string, string> = {
    rule: "#2f7d5d",
    faq: "#b8863b",
    ai: "#2f5fb3",
    handoff: "#b3382f",
    admin: "#6b5b95",
    other: "var(--text-soft)",
  };

  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        {Object.entries(mix)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <div key={k} style={{ width: `${(v / total) * 100}%`, background: colors[k] }} />
          ))}
      </div>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(mix)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <li key={k} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: colors[k] }}
              />
              <span>{MIX_LABEL[k] ?? k}</span>
              <span className="soft ml-auto">
                {v} ครั้ง ({Math.round((v / total) * 100)}%)
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
