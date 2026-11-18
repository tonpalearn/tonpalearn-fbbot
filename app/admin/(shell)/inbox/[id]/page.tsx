"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { LeadFacts, type LeadLike } from "@/components/lead";
import type { DeadlineLevel } from "@/lib/today";
import { IconAlert, IconBack, IconCheck, IconSend } from "@/components/icons";
import {
  api,
  CopyButton,
  DeadlineBadge,
  draftDeadline,
  ErrorBox,
  LEAD_STATUS_LABEL,
  LeadStatusBadge,
  Loading,
  Notice,
  relTime,
  SegmentChip,
  SourceTag,
  StateBadge,
  thaiTime,
  useLoad,
} from "@/components/ui";

interface MessageRow {
  id: string;
  direction: "in" | "out";
  sender: "user" | "bot" | "admin" | "system";
  content: string | null;
  answerSource: string | null;
  createdAt: string;
}

interface Lead extends LeadLike {
  id: string;
  status: string;
  created_at: string;
}

interface Detail {
  id: string;
  state: string;
  name: string;
  lastUserMessageAt: string | null;
  messages: MessageRow[];
  followup?: { draft: string | null; draftAt: string | null; sentAt: string | null; variant: string | null };
  lead?: Lead | null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SENDER: Record<MessageRow["sender"], string> = { user: "ลูกค้า", bot: "บอต", admin: "ต้น", system: "ระบบ" };

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useLoad<Detail>(`/api/admin/conversations/${id}`);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // เปิดมาให้เห็นข้อความล่าสุดก่อน
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [data?.messages.length]);

  async function act(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setSendError(null);
    setNotice(null);
    try {
      const res = await api<{ note?: string | null }>(path, { method, body: JSON.stringify(body ?? {}) });
      if (res.note) setNotice(res.note);
      await reload();
      return true;
    } catch (err) {
      setSendError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim() === "") return;
    const okSent = await act(`/api/admin/conversations/${id}/reply`, { text });
    if (okSent) setText("");
  }

  if (loading && !data) return <Loading rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const lastAt = data.lastUserMessageAt ? new Date(data.lastUserMessageAt).getTime() : 0;
  const outsideWindow = lastAt === 0 || Date.now() - lastAt > WINDOW_MS;
  const draft = data.followup?.draft ?? null;
  const dl = draftDeadline(data.lastUserMessageAt);
  const holding = data.state === "human_active";

  return (
    <div className="space-y-4">
      {/* หัว: กลับ · ชื่อ · สถานะ · ปุ่มถือสาย */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/admin/inbox" className="btn-ghost px-2" aria-label="กลับไปกล่องข้อความ">
          <IconBack />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[1.4rem] font-semibold">{data.name}</h1>
          <p className="soft text-[0.9rem]">ลูกค้าพิมพ์ล่าสุด {relTime(data.lastUserMessageAt)}</p>
        </div>
        <div className="flex basis-full items-center justify-between gap-2 sm:basis-auto sm:justify-end">
        <StateBadge state={data.state} />
        {holding ? (
          <button className="btn-quiet" disabled={busy} onClick={() => act(`/api/admin/conversations/${id}/release`)}>
            คืนให้บอต
          </button>
        ) : (
          <button className="btn-gold" disabled={busy} onClick={() => act(`/api/admin/conversations/${id}/takeover`)}>
            ขอคุยเอง
          </button>
        )}
        </div>
      </div>

      {/* 1 · การ์ดสรุปผู้สนใจ */}
      {data.lead ? (
        <LeadCard lead={data.lead} onStatus={(s) => act(`/api/admin/leads/${data.lead!.id}`, { status: s }, "PUT")} busy={busy} />
      ) : (
        <p className="card-quiet soft px-4 py-3 text-[0.95rem]">ห้องนี้ยังไม่มีข้อมูลผู้สนใจ (บอตยังเก็บไม่ครบ หรือเป็นแชททั่วไป)</p>
      )}

      {outsideWindow && (
        <div className="card flex gap-3 p-4" role="note" style={{ borderColor: "var(--amber-line)", background: "var(--amber-soft)" }}>
          <span style={{ color: "var(--amber)" }} className="mt-0.5">
            <IconAlert />
          </span>
          <div>
            <p className="font-medium" style={{ color: "var(--amber)" }}>
              เลย 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้าแล้ว
            </p>
            <p className="mt-0.5 text-[0.95rem]">
              Facebook ไม่ให้ส่งข้อความธรรมดาแล้ว ระบบจะลองส่งแบบ “เจ้าหน้าที่ติดต่อกลับ” ให้ แต่ถ้าเพจยังไม่ได้สิทธิ์นั้นจะส่งไม่ผ่าน —
              ติดต่อทางเบอร์หรือ LINE ในการ์ดด้านบนแทนได้
            </p>
          </div>
        </div>
      )}

      {/* 2 · ร่างตามรอบ 2 (บอตไม่ส่งเอง — ต้นแก้แล้วกดส่งเอง) */}
      {draft && (
        <DraftComposer
          key={data.followup?.draftAt ?? draft}
          draft={draft}
          deadline={dl.deadline}
          level={dl.level}
          autoSent={Boolean(data.followup?.sentAt)}
          busy={busy}
          onSend={(t) => act(`/api/admin/conversations/${id}/draft`, { text: t })}
          onDone={() => act(`/api/admin/conversations/${id}/draft`, undefined, "DELETE")}
        />
      )}

      {notice && <Notice tone="warn">{notice}</Notice>}

      {/* 3 · แชท */}
      <section aria-label="ข้อความในแชท" className="card">
        <div ref={chatRef} className="max-h-[62vh] space-y-3 overflow-y-auto p-4">
          {data.messages.length === 0 && <p className="soft py-6 text-center">ยังไม่มีข้อความในบทสนทนานี้</p>}
          {data.messages.map((m) => (m.sender === "system" ? <SystemNote key={m.id} m={m} /> : <Bubble key={m.id} m={m} />))}
        </div>
      </section>

      {/* 4 · กล่องตอบ — ติดล่างจอ (เหนือแท็บบนมือถือ) */}
      <form
        onSubmit={send}
        className="card sticky bottom-[calc(62px+env(safe-area-inset-bottom,0px))] z-20 space-y-2 p-3 lg:bottom-3"
        style={{ boxShadow: "var(--shadow-m)" }}
      >
        <label htmlFor="reply" className="sr-only">
          พิมพ์ข้อความตอบลูกค้า
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="reply"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e as unknown as React.FormEvent);
            }}
            placeholder="พิมพ์ข้อความตอบลูกค้า..."
          />
          <button type="submit" className="btn-gold flex-none" disabled={busy || text.trim() === ""} aria-label="ส่งข้อความ">
            <IconSend size={18} />
            <span className="hidden sm:inline">{busy ? "กำลังส่ง..." : "ส่ง"}</span>
          </button>
        </div>
        {sendError && (
          <p role="alert" className="text-[0.95rem]" style={{ color: "var(--red)" }}>
            {sendError}
          </p>
        )}
        {!holding && (
          <p className="soft text-[0.85rem]">ตอบได้เลย แต่บอตยังทำงานอยู่ — ถ้าจะคุยเองยาว ๆ กด “ขอคุยเอง” ก่อน</p>
        )}
      </form>
    </div>
  );
}

function LeadCard({ lead, onStatus, busy }: { lead: Lead; onStatus: (s: string) => void; busy: boolean }) {
  return (
    <section className="card card-hot space-y-3 p-4" aria-labelledby="lead-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="lead-h" className="font-semibold">
          สรุปผู้สนใจ
        </h2>
        <SegmentChip segment={lead.segment} />
        <LeadStatusBadge status={lead.status} />
        <span className="soft ml-auto text-[0.88rem]">เก็บได้ {thaiTime(lead.created_at)}</span>
      </div>
      <LeadFacts lead={lead} />
      <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <span className="soft text-[0.9rem]">เปลี่ยนสถานะ:</span>
        {Object.keys(LEAD_STATUS_LABEL).map((s) => (
          <button
            key={s}
            type="button"
            className="tab"
            aria-pressed={lead.status === s}
            disabled={busy || lead.status === s}
            onClick={() => onStatus(s)}
          >
            {LEAD_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </section>
  );
}

function Bubble({ m }: { m: MessageRow }) {
  const mine = m.direction === "out";
  const admin = m.sender === "admin";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className="max-w-[86%] rounded-2xl px-4 py-2.5"
        style={{
          background: mine ? (admin ? "var(--teal-soft)" : "var(--gold-soft)") : "var(--bg2)",
          border: `1px solid ${mine ? (admin ? "var(--teal-line)" : "var(--gold-line)") : "var(--line)"}`,
          borderBottomRightRadius: mine ? 6 : undefined,
          borderBottomLeftRadius: mine ? undefined : 6,
        }}
      >
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          <span className="text-[0.82rem] font-medium">{SENDER[m.sender]}</span>
          <SourceTag source={m.answerSource} />
          <span className="soft tnum ml-auto text-[0.82rem]">{thaiTime(m.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

/** ข้อความของระบบ (เช่น สรุปผู้สนใจ) — ลูกค้าไม่เห็น */
function SystemNote({ m }: { m: MessageRow }) {
  return (
    <div className="card-quiet mx-auto max-w-[92%] px-4 py-2 text-[0.92rem]">
      <p className="soft mb-0.5 text-[0.8rem]">
        <SourceTag source={m.answerSource ?? "system"} /> · {thaiTime(m.createdAt)}
      </p>
      <p className="whitespace-pre-wrap break-words">{m.content}</p>
    </div>
  );
}

/** ร่างรอบ 2: แก้ในกล่อง → ตรวจช่อง [ ] → ยืนยัน → ส่งทาง Messenger (หรือกดว่าส่งเองแล้ว) */
function DraftComposer({
  draft,
  deadline,
  level,
  autoSent,
  busy,
  onSend,
  onDone,
}: {
  draft: string;
  deadline: string | null;
  level: DeadlineLevel;
  autoSent: boolean;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
  onDone: () => Promise<boolean>;
}) {
  const [text, setText] = useState(draft);
  const [confirming, setConfirming] = useState(false);
  const holes = [...new Set(text.match(/\[[^\]\n]{1,40}\]|\{[^}\n]{1,40}\}/g) ?? [])];
  const expired = level === "expired";
  const canSend = !busy && !expired && text.trim() !== "" && holes.length === 0;

  return (
    <section className="card space-y-3 p-4" data-testid="round-two-draft" aria-labelledby="draft-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="draft-h" className="font-semibold">
          ร่างตามรอบ 2 (วันที่ 3–5) — ต้นแก้แล้วกดส่ง
        </h2>
        <DeadlineBadge deadline={deadline} level={level} />
      </div>

      <label htmlFor="draft-text" className="sr-only">
        ข้อความร่างรอบ 2
      </label>
      <textarea
        id="draft-text"
        rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setConfirming(false);
        }}
        aria-describedby="draft-help"
      />

      {holes.length > 0 ? (
        <p id="draft-help" className="chip chip-amber whitespace-normal" role="status">
          <span className="dot" aria-hidden="true" />
          เติมก่อนส่ง: {holes.join(" ")}
        </p>
      ) : (
        <p id="draft-help" className="soft text-[0.9rem]">
          {expired
            ? "เลย 7 วันแล้ว Facebook ไม่ให้ส่ง — ติดต่อทางเบอร์หรือ LINE ในการ์ดด้านบน"
            : `พร้อมส่ง${deadline ? ` · ส่งได้ถึง ${thaiTime(deadline)}` : ""}${autoSent ? " · บอตตามอัตโนมัติไปแล้ว 1 ครั้ง" : ""}`}
        </p>
      )}

      {confirming ? (
        <div className="card-quiet space-y-3 p-3" role="alertdialog" aria-labelledby="draft-confirm-h">
          <p id="draft-confirm-h" className="font-medium">
            ส่งข้อความนี้ให้ลูกค้าทาง Messenger เลยไหม
          </p>
          <p className="soft text-[0.9rem]">
            ส่งแล้วดึงกลับไม่ได้ · ห้องนี้จะเปลี่ยนเป็น “ต้นคุยเอง” บอตหยุดตอบจนกว่าจะกดคืนให้บอต
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-gold"
              disabled={!canSend}
              onClick={async () => {
                const ok = await onSend(text.trim());
                if (!ok) setConfirming(false);
              }}
            >
              <IconSend size={18} /> {busy ? "กำลังส่ง..." : "ยืนยัน ส่งเลย"}
            </button>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => setConfirming(false)}>
              ยังก่อน
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-gold" disabled={!canSend} onClick={() => setConfirming(true)}>
            <IconSend size={18} /> ส่งให้ลูกค้า
          </button>
          <CopyButton text={text} label="คัดลอก" className="btn-quiet" />
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm("ส่งใน Business Suite แล้ว หรือไม่ใช้ร่างนี้? ร่างจะหายจากคิวงานวันนี้")) void onDone();
            }}
          >
            <IconCheck size={18} /> ส่งใน Business Suite แล้ว
          </button>
        </div>
      )}
    </section>
  );
}
