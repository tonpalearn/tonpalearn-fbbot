"use client";

import { useState } from "react";
import { api, Empty, ErrorBox, Field, Loading, useLoad } from "@/components/ui";

interface Rule {
  id: string;
  name: string;
  match_type: "contains" | "exact" | "regex";
  pattern: string;
  action: "reply" | "collect_lead" | "handoff" | "menu";
  reply_text: string | null;
  priority: number;
  is_active: boolean;
  hit_count: number;
}

const MATCH_LABEL = {
  contains: "มีคำนี้อยู่ในข้อความ",
  exact: "ตรงทั้งข้อความ",
  regex: "รูปแบบ (regex)",
} as const;

const ACTION_LABEL = {
  reply: "ตอบข้อความ",
  collect_lead: "เริ่มเก็บข้อมูลผู้สนใจ",
  handoff: "โอนหาคน",
  menu: "แสดงเมนู",
} as const;

export default function RulesPage() {
  const { data, error, loading, reload } = useLoad<{ items: Rule[] }>("/api/admin/rules");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    match_type: "contains" as Rule["match_type"],
    pattern: "",
    action: "reply" as Rule["action"],
    reply_text: "",
    priority: 100,
  });

  // ช่องทดลองพิมพ์
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/rules", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, name: "", pattern: "", reply_text: "" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(item: Rule, body: Partial<Rule>) {
    try {
      await api(`/api/admin/rules/${item.id}`, { method: "PUT", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function remove(item: Rule) {
    if (!confirm(`ลบกติกา “${item.name}” ใช่ไหมครับ`)) return;
    try {
      await api(`/api/admin/rules/${item.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setTestResult(null);
    try {
      const res = await api<{ explain: string }>("/api/admin/rules/test", {
        method: "POST",
        body: JSON.stringify({ text: testText }),
      });
      setTestResult(res.explain);
    } catch (err) {
      setTestResult((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">กติกา</h1>
      <p className="soft">
        บอตจะไล่ตรวจกติกาจากเลขลำดับน้อยไปมาก เจอข้อแรกที่ตรงแล้วหยุด —
        กติกาถูกตรวจก่อนคำถามที่ถามบ่อยและก่อนเรียกโมเดลเสมอ
      </p>

      <form onSubmit={runTest} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">ทดลองพิมพ์ข้อความ</h2>
        <p className="soft text-[0.95rem]">
          พิมพ์เหมือนที่ลูกค้าจะพิมพ์ แล้วดูว่ากติกาข้อไหนจะโดนจับ
        </p>
        <input
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="เช่น สนใจคอร์สครับ ราคาเท่าไร"
        />
        <button className="btn-quiet" disabled={testText.trim() === ""}>
          ทดลอง
        </button>
        {testResult && (
          <p className="rounded-lg p-3" style={{ background: "var(--accent-weak)" }}>
            {testResult}
          </p>
        )}
      </form>

      <form onSubmit={add} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">เพิ่มกติกาใหม่</h2>
        <Field label="ชื่อกติกา" hint="ตั้งให้รู้เรื่อง เช่น “ขอใบเสนอราคา”">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชนิดการจับคู่">
            <select
              value={form.match_type}
              onChange={(e) =>
                setForm({ ...form, match_type: e.target.value as Rule["match_type"] })
              }
            >
              {Object.entries(MATCH_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ทำอะไรเมื่อจับได้">
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value as Rule["action"] })}
            >
              {Object.entries(ACTION_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="คำหรือรูปแบบที่จะจับ">
          <input
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            placeholder="เช่น ใบเสนอราคา"
          />
        </Field>

        {form.action === "reply" && (
          <Field label="ข้อความตอบ">
            <textarea
              rows={3}
              value={form.reply_text}
              onChange={(e) => setForm({ ...form, reply_text: e.target.value })}
            />
          </Field>
        )}

        <Field label="ลำดับความสำคัญ" hint="เลขน้อยตรวจก่อน (ค่าเริ่มต้น 100)">
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          />
        </Field>

        <button className="btn-gold" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "เพิ่มกติกา"}
        </button>
      </form>

      {msg && <ErrorBox message={msg} />}
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty label="ยังไม่มีกติกาในระบบ" />}

      <div className="space-y-3">
        {data?.items.map((r) => (
          <div key={r.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[0.85rem]"
                style={{ background: "var(--accent-weak)" }}
              >
                #{r.priority}
              </span>
              <span className="font-medium">{r.name}</span>
              {!r.is_active && <span className="soft text-[0.85rem]">ปิดใช้งานอยู่</span>}
              <span className="soft ml-auto text-[0.85rem]">โดนจับ {r.hit_count} ครั้ง</span>
            </div>
            <p className="soft">
              {MATCH_LABEL[r.match_type]}: <code>{r.pattern}</code> → {ACTION_LABEL[r.action]}
            </p>
            {r.reply_text && <p className="whitespace-pre-wrap">{r.reply_text}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-quiet" onClick={() => patch(r, { is_active: !r.is_active })}>
                {r.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button className="btn-quiet" onClick={() => remove(r)}>
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
