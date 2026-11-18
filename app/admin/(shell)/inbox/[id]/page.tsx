"use client";

import Link from "next/link";
import { use, useState } from "react";
import { api, ErrorBox, Loading, SourceTag, StateBadge, thaiTime, useLoad } from "@/components/ui";

interface MessageRow {
  id: string;
  direction: "in" | "out";
  sender: "user" | "bot" | "admin" | "system";
  content: string | null;
  answerSource: string | null;
  createdAt: string;
}

interface Detail {
  id: string;
  state: string;
  name: string;
  lastUserMessageAt: string | null;
  messages: MessageRow[];
  followup?: { draft: string | null; draftAt: string | null; sentAt: string | null; variant: string | null };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ร่างข้อความตามรอบ 2 (วันที่ 3–5) — บอตห้ามส่งเอง ต้นคัดลอกไปแก้แล้วส่งใน Business Suite
 * หลังพ้น 24 ชม. เพจส่งได้เฉพาะข้อความที่คนพิมพ์ และไม่เกิน 7 วันนับจากข้อความล่าสุดของลูกค้า
 */
function RoundTwoDraft({ draft, lastUserMessageAt, sentAt }: { draft: string; lastUserMessageAt: string | null; sentAt: string | null }) {
  const [copied, setCopied] = useState<"" | "ok" | "manual">("");
  const last = lastUserMessageAt ? new Date(lastUserMessageAt).getTime() : 0;
  const deadline = last ? new Date(last + SEVEN_DAYS_MS) : null;
  const expired = deadline ? Date.now() > deadline.getTime() : false;
  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(draft);
      ok = true;
    } catch {
      // บางเบราว์เซอร์/หน้าต่างฝังไม่ให้ใช้ clipboard API → ถอยไปวิธีเก่า
      const ta = document.createElement("textarea");
      ta.value = draft;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    setCopied(ok ? "ok" : "manual");
    setTimeout(() => setCopied(""), 2500);
  }
  return (
    <div className="card space-y-2 p-4" data-testid="round-two-draft">
      <p className="font-medium">ร่างตามรอบ 2 (วันที่ 3–5) — บอตไม่ส่งเอง</p>
      <p className="select-all whitespace-pre-wrap rounded-xl p-3" style={{ background: "var(--bg)", border: "1px solid var(--line)" }}>
        {draft}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-gold" onClick={copy} type="button">
          {copied === "ok" ? "คัดลอกแล้ว" : copied === "manual" ? "คัดลอกไม่ได้ — ลากเลือกข้อความเอง" : "คัดลอกข้อความ"}
        </button>
        <span className="soft text-[0.9rem]">
          แทน [ปัญหา] ด้วยคำสั้น ๆ ของต้นก่อนส่ง · ส่งใน Business Suite
          {deadline ? ` · ส่งได้ถึง ${thaiTime(deadline.toISOString())}` : ""}
          {expired ? " (เลยกำหนดแล้ว)" : ""}
          {sentAt ? " · บอตตามอัตโนมัติไปแล้ว 1 ครั้ง" : ""}
        </span>
      </div>
    </div>
  );
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useLoad<Detail>(`/api/admin/conversations/${id}`);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setSendError(null);
    setNotice(null);
    try {
      const res = await api<{ note?: string | null }>(path, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
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

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const lastAt = data.lastUserMessageAt ? new Date(data.lastUserMessageAt).getTime() : 0;
  const outsideWindow = lastAt === 0 || Date.now() - lastAt > WINDOW_MS;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/inbox" className="btn-quiet">
          ← กลับ
        </Link>
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <StateBadge state={data.state} />
        <div className="ml-auto flex gap-2">
          {data.state !== "human_active" ? (
            <button
              className="btn-gold"
              disabled={busy}
              onClick={() => act(`/api/admin/conversations/${id}/takeover`)}
            >
              ขอคุยเอง
            </button>
          ) : (
            <button
              className="btn-quiet"
              disabled={busy}
              onClick={() => act(`/api/admin/conversations/${id}/release`)}
            >
              คืนให้บอต
            </button>
          )}
        </div>
      </div>

      {outsideWindow && (
        <div className="card p-4" style={{ borderColor: "#b4691a" }}>
          <p className="font-medium" style={{ color: "#b4691a" }}>
            เลย 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้าแล้ว
          </p>
          <p className="soft mt-1 text-[0.95rem]">
            Facebook จำกัดว่าเลยช่วงนี้จะส่งข้อความธรรมดาไม่ได้ ระบบจะลองส่งแบบ
            “เจ้าหน้าที่ติดต่อกลับ” ให้ แต่ถ้าเพจยังไม่ได้รับสิทธิ์นั้นจะส่งไม่ผ่าน —
            แนะนำให้ติดต่อทางเบอร์หรืออีเมลที่เก็บไว้ในหน้าผู้สนใจแทนครับ
          </p>
        </div>
      )}

      {data.followup?.draft && (
        <RoundTwoDraft
          draft={data.followup.draft}
          lastUserMessageAt={data.lastUserMessageAt}
          sentAt={data.followup.sentAt}
        />
      )}

      {notice && (
        <p className="soft text-[0.95rem]" style={{ color: "#b4691a" }}>
          {notice}
        </p>
      )}

      <div className="card space-y-3 p-4">
        {data.messages.length === 0 && <p className="soft">ยังไม่มีข้อความในบทสนทนานี้</p>}
        {data.messages.map((m) => (
          <div
            key={m.id}
            className={m.direction === "in" ? "flex justify-start" : "flex justify-end"}
          >
            <div
              className="max-w-[85%] rounded-2xl px-4 py-2"
              style={{
                background:
                  m.direction === "in"
                    ? "var(--bg)"
                    : m.sender === "admin"
                      ? "var(--accent-weak)"
                      : "var(--accent-weak)",
                border: "1px solid var(--line)",
              }}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="soft text-[0.8rem]">
                  {m.sender === "user"
                    ? "ลูกค้า"
                    : m.sender === "bot"
                      ? "บอต"
                      : m.sender === "admin"
                        ? "แอดมิน"
                        : "ระบบ"}
                </span>
                <SourceTag source={m.answerSource} />
                <span className="soft ml-auto text-[0.8rem]">{thaiTime(m.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="space-y-2">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="พิมพ์ข้อความตอบลูกค้า..."
        />
        {sendError && (
          <p className="text-[0.95rem]" style={{ color: "#b3382f" }}>
            {sendError}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-gold" disabled={busy || text.trim() === ""}>
            {busy ? "กำลังส่ง..." : "ส่งข้อความ"}
          </button>
          {data.state !== "human_active" && (
            <span className="soft text-[0.9rem]">
              ตอบตอนนี้ได้ แต่บอตยังทำงานอยู่ — ถ้าจะคุยเองยาว ๆ กด “ขอคุยเอง” ก่อนครับ
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
