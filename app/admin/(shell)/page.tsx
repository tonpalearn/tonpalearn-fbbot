"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LeadLine } from "@/components/lead";
import { IconChevron } from "@/components/icons";
import {
  DeadlineBadge,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  RefreshButton,
  relTime,
  StateBadge,
  thaiTime,
  timeLeft,
  useLoad,
} from "@/components/ui";
import type { TodayItem, TodayQueue } from "@/lib/today";

interface BotStatus {
  botEnabled: boolean;
  pageRegistered: boolean;
  lastBotReplyAt: string | null;
  lastCustomerMessageAt: string | null;
  webhookErrors24h: number;
  messagesToday: number;
  aiCallsToday: number;
  aiCallCap: number;
}

type TodayResponse = TodayQueue & { status: BotStatus; generatedAt: string };

interface Stats {
  messagesToday: number;
  unreadConversations: number;
  newLeadsThisWeek: number;
  aiCallsToday: number;
  aiCallCap: number;
  answerMix: Record<string, number>;
  answerMixDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function TodayPage() {
  const today = useLoad<TodayResponse>("/api/admin/today");
  const stats = useLoad<{ stats: Stats }>("/api/admin/stats");
  const d = today.data;

  // อัปเดต "ผ่านมากี่นาที" เองทุกนาที โดยไม่ต้องโหลดใหม่
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayLabel = new Date(now).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" });
  const urgent = d ? d.waiting.length + d.leads.length + d.draftsSoon.length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="งานวันนี้"
        subtitle={todayLabel}
        actions={
          <RefreshButton
            busy={today.loading}
            onClick={() => {
              void today.reload();
              void stats.reload();
            }}
          />
        }
      />

      {d && <StatusLine s={d.status} now={now} />}

      {today.loading && !d && <Loading rows={4} />}
      {today.error && <ErrorBox message={today.error} onRetry={today.reload} />}

      {d && (
        <>
          {urgent > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="สรุปงาน">
            <CountChip n={d.waiting.length} label="รอคนตอบ" tone="red" href="#waiting" />
            <CountChip n={d.leads.length} label="ผู้สนใจใหม่" tone="gold" href="#leads" />
            <CountChip n={d.draftsSoon.length} label="ร่างรอบ 2 ใกล้หมดเวลา" tone="amber" href="#drafts" />
          </div>
          )}

          {urgent === 0 && (
            <Empty
              label="ไม่มีงานค้างตอนนี้"
              hint="ไม่มีแชทรอคน ไม่มีผู้สนใจที่ยังไม่ได้ติดต่อ และไม่มีร่างรอบ 2 ที่ใกล้หมดเวลา"
              action={
                <Link href="/admin/inbox" className="btn-quiet">
                  ดูกล่องข้อความทั้งหมด
                </Link>
              }
            />
          )}

          {d.waiting.length > 0 && (
            <Group id="waiting" step={1} title="แชทรอคนตอบ" hint="เรียงจากรอนานสุด · ลูกค้ารอคำตอบจากต้น">
              {d.waiting.map((i) => (
                <ItemCard key={i.conversationId} item={i} now={now} />
              ))}
            </Group>
          )}

          {d.leads.length > 0 && (
            <Group id="leads" step={2} title="ผู้สนใจใหม่ (ยังไม่ได้ติดต่อ)" hint="ล่าสุดขึ้นก่อน · กดเปลี่ยนสถานะได้ในหน้าผู้สนใจ">
              {d.leads.map((i) => (
                <ItemCard key={i.lead?.id ?? i.conversationId} item={i} now={now} />
              ))}
            </Group>
          )}

          {(d.draftsSoon.length > 0 || d.draftsLater.length > 0 || d.draftsExpired > 0) && (
            <Group
              id="drafts"
              step={3}
              title="ร่างตามรอบ 2 ที่ต้นต้องส่งเอง"
              hint="บอตไม่ส่งเอง · ส่งได้ภายใน 7 วันนับจากข้อความล่าสุดของลูกค้า · ขึ้นสีเมื่อเหลือไม่เกิน 2 วัน"
            >
              {d.draftsSoon.map((i) => (
                <ItemCard key={i.conversationId} item={i} now={now} />
              ))}
              {d.draftsSoon.length === 0 && <p className="soft px-1">ไม่มีร่างที่ใกล้หมดเวลา</p>}
              {d.draftsLater.length > 0 && (
                <details className="card-quiet group">
                  <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-4 font-medium">
                    <IconChevron size={18} className="transition-transform group-open:rotate-90" />
                    ยังมีเวลา · ไม่ต้องรีบ ({d.draftsLater.length})
                  </summary>
                  <ul className="space-y-1 px-2 pb-2">
                    {d.draftsLater.map((i) => (
                      <li key={i.conversationId}>
                        <Link
                          href={`/admin/inbox/${i.conversationId}`}
                          className="row-link flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2"
                        >
                          <span className="font-medium">{i.name}</span>
                          <span className="soft text-[0.92rem]">
                            ส่งได้ถึง {thaiTime(i.deadline)} · {timeLeft(i.deadline!, now)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {d.draftsExpired > 0 && (
                <p className="soft px-1 text-[0.92rem]">
                  เลยกำหนดแล้ว {d.draftsExpired} ห้อง — ส่งทางแชทไม่ได้ ถ้ามีเบอร์/LINE ติดต่อทางนั้นแทน
                </p>
              )}
            </Group>
          )}
        </>
      )}

      {stats.data && <Metrics s={stats.data.stats} />}
    </div>
  );
}

function StatusLine({ s, now }: { s: BotStatus; now: number }) {
  const aiHigh = s.aiCallCap > 0 && s.aiCallsToday >= s.aiCallCap * 0.8;
  const tone = !s.botEnabled ? "red" : s.webhookErrors24h > 0 || aiHigh ? "amber" : "teal";
  const color = `var(--${tone})`;
  const head = !s.botEnabled ? "ปิดบอตอยู่ — ไม่มีการตอบอัตโนมัติ" : "บอตทำงานอยู่";
  const bits = [
    s.lastBotReplyAt ? `ตอบล่าสุด ${relTime(s.lastBotReplyAt, now)}` : "ยังไม่เคยตอบ",
    `ข้อความวันนี้ ${s.messagesToday.toLocaleString("th-TH")}`,
    `เรียก AI ${s.aiCallsToday.toLocaleString("th-TH")}/${s.aiCallCap.toLocaleString("th-TH")}`,
  ];
  return (
    <div
      role="status"
      className="card-quiet flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[0.93rem]"
      style={{ borderColor: `var(--${tone}-line)` }}
    >
      <span className="flex items-center gap-2 font-semibold" style={{ color }}>
        <span className="dot" aria-hidden="true" />
        {head}
      </span>
      <span className="soft">{bits.join(" · ")}</span>
      {s.webhookErrors24h > 0 && (
        <span style={{ color: "var(--amber)" }}>· รับข้อความพลาด {s.webhookErrors24h} ครั้งใน 24 ชม.</span>
      )}
      {aiHigh && <span style={{ color: "var(--amber)" }}>· ใกล้เพดานเรียก AI วันนี้</span>}
      {!s.pageRegistered && (
        <Link href="/admin/settings" className="underline" style={{ color: "var(--amber)" }}>
          ยังไม่ได้ลงทะเบียนเพจ
        </Link>
      )}
    </div>
  );
}

function CountChip({ n, label, tone, href }: { n: number; label: string; tone: string; href: string }) {
  const on = n > 0;
  return (
    <a
      href={on ? href : undefined}
      className={`chip ${on ? `chip-${tone}` : ""} min-h-[40px] px-3.5 text-[0.95rem]`}
      aria-disabled={!on}
    >
      <span className="tnum font-semibold">{n}</span> {label}
    </a>
  );
}

function Group({
  id,
  step,
  title,
  hint,
  children,
}: {
  id: string;
  step: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3">
      <div className="flex items-baseline gap-3">
        <span
          className="tnum grid h-7 w-7 flex-none place-items-center rounded-full text-[0.85rem] font-semibold"
          style={{ background: "var(--tx)", color: "var(--bg)" }}
          aria-hidden="true"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[1.15rem] font-semibold">
            {title}
          </h2>
          <p className="soft text-[0.9rem]">{hint}</p>
        </div>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

const WHY: Record<TodayItem["why"], { label: string; cls: string }> = {
  awaiting_human: { label: "รอคนตอบ", cls: "chip chip-red" },
  customer_replied: { label: "ลูกค้าตอบกลับแล้ว", cls: "chip chip-red" },
  new_lead: { label: "ผู้สนใจใหม่", cls: "chip chip-gold" },
  draft: { label: "มีร่างรอบ 2", cls: "chip chip-amber" },
};

const ACTION: Record<TodayItem["kind"], string> = {
  waiting: "เปิดแชทตอบ",
  lead: "เปิดแชท",
  draft: "เปิดแชทคัดลอกร่าง",
};

function ItemCard({ item, now }: { item: TodayItem; now: number }) {
  const why = WHY[item.why];
  const since = item.since ? new Date(item.since).getTime() : 0;
  const pastWindow = item.kind === "waiting" && since > 0 && now - since > DAY_MS;
  const sinceLabel =
    item.kind === "lead" ? `เก็บข้อมูลได้ ${relTime(item.since, now)}` : `ลูกค้าพิมพ์ล่าสุด ${relTime(item.since, now)}`;

  return (
    <article className={`card p-4 ${item.kind === "waiting" ? "card-hot" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="f-head text-[1.05rem] font-semibold">{item.name}</h3>
        <span className={why.cls}>{why.label}</span>
        {item.unread && (
          <span className="chip chip-gold">
            <span className="dot" aria-hidden="true" /> ยังไม่ได้อ่าน
          </span>
        )}
        {item.kind === "draft" && item.state && <StateBadge state={item.state} />}
      </div>

      <p className="soft mt-1 flex flex-wrap gap-x-2 text-[0.92rem]">
        <span>{sinceLabel}</span>
        {pastWindow && <span style={{ color: "var(--amber)" }}>· เลย 24 ชม. — ตอบแชทธรรมดาไม่ได้แล้ว</span>}
      </p>

      {item.lead && (
        <div className="mt-2.5">
          <LeadLine lead={item.lead} />
        </div>
      )}
      {!item.lead && item.lastMessage && <p className="mt-2 line-clamp-2">“{item.lastMessage}”</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <DeadlineBadge deadline={item.deadline} level={item.deadlineLevel} quietWhenOk />
        {item.conversationId ? (
          <Link href={`/admin/inbox/${item.conversationId}`} className="btn-gold ml-auto">
            {ACTION[item.kind]}
            <IconChevron size={18} />
          </Link>
        ) : (
          <Link href="/admin/leads" className="btn-quiet ml-auto">
            ดูในหน้าผู้สนใจ
          </Link>
        )}
      </div>
    </article>
  );
}

const MIX_LABEL: Record<string, string> = {
  rule: "กติกา",
  faq: "คำถามที่ถามบ่อย",
  ai: "ฐานความรู้ + AI",
  handoff: "โอนหาคน",
  admin: "แอดมินพิมพ์เอง",
  other: "อื่น ๆ (โฟลว์แอด ฯลฯ)",
};
const MIX_COLOR: Record<string, string> = {
  rule: "var(--teal)",
  faq: "var(--g2)",
  ai: "var(--blue)",
  handoff: "var(--red)",
  admin: "var(--tx2)",
  other: "var(--line2)",
};

/** ตัวเลขรอง — แถวเล็ก ไม่แย่งสายตาจากงานด้านบน */
function Metrics({ s }: { s: Stats }) {
  const items = [
    ["ข้อความวันนี้", s.messagesToday.toLocaleString("th-TH")],
    ["แชทยังไม่อ่าน", s.unreadConversations.toLocaleString("th-TH")],
    ["ผู้สนใจใหม่ 7 วัน", s.newLeadsThisWeek.toLocaleString("th-TH")],
    ["เรียก AI วันนี้", `${s.aiCallsToday.toLocaleString("th-TH")} / ${s.aiCallCap.toLocaleString("th-TH")}`],
  ];
  const mix = Object.entries(s.answerMix ?? {}).filter(([, v]) => v > 0);
  const total = mix.reduce((a, [, v]) => a + v, 0);
  return (
    <section aria-label="ตัวเลขภาพรวม" className="space-y-3 border-t pt-5" style={{ borderColor: "var(--line)" }}>
      <p className="eyebrow">ภาพรวม</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="card-quiet px-3.5 py-2.5">
            <dt className="soft text-[0.85rem]">{k}</dt>
            <dd className="tnum f-head text-[1.2rem] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {total > 0 && (
        <details className="card-quiet group">
          <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-4 font-medium">
            <IconChevron size={18} className="transition-transform group-open:rotate-90" />
            คำตอบมาจากไหนบ้าง · {s.answerMixDays} วันล่าสุด
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }} aria-hidden="true">
              {mix.map(([k, v]) => (
                <div key={k} style={{ width: `${(v / total) * 100}%`, background: MIX_COLOR[k] }} />
              ))}
            </div>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {mix
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2 text-[0.93rem]">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: MIX_COLOR[k] }} aria-hidden="true" />
                    <span>{MIX_LABEL[k] ?? k}</span>
                    <span className="soft tnum ml-auto">
                      {v} ครั้ง ({Math.round((v / total) * 100)}%)
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
