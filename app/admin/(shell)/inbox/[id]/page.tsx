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
