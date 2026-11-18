"use client";

import { useState } from "react";
import { IconPlus } from "@/components/icons";
import { api, Empty, ErrorBox, Field, Loading, PageHeader, Section, useLoad } from "@/components/ui";

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
  regex: "รูปแบบ (regex) — สำหรับผู้ชำนาญ",
} as const;

const MATCH_SHORT = { contains: "มีคำนี้", exact: "ตรงทั้งข้อความ", regex: "รูปแบบ" } as const;

const ACTION_LABEL = {
  reply: "ตอบข้อความ",
  collect_lead: "เริ่มเก็บข้อมูลผู้สนใจ",
  handoff: "โอนหาคน",
  menu: "แสดงเมนู",
} as const;

const EMPTY_FORM = {
  name: "",
  match_type: "contains" as Rule["match_type"],
  pattern: "",
  action: "reply" as Rule["action"],
  reply_text: "",
  priority: 100,
};

export default function RulesPage() {
  const { data, error, loading, reload } = useLoad<{ items: Rule[] }>("/api/admin/rules");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/rules", { method: "POST", body: JSON.stringify(form) });
      setForm(EMPTY_FORM);
      setAdding(false);
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
    if (!confirm(`ลบกติกา “${item.name}” ใช่ไหมครับ (ลบแล้วกู้คืนไม่ได้)`)) return;
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
      const res = await api<{ explain: string }>("/api/admin/rules/test", { method: "POST", body: JSON.stringify({ text: testText }) });
      setTestResult(res.explain);
    } catch (err) {
      setTestResult((err as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        stackActions
        title="กติกา"
        subtitle="บอตตรวจกติกาก่อนคำถามที่ถามบ่อยและก่อนเรียก AI เสมอ · ไล่จากเลขลำดับน้อยไปมาก เจอข้อแรกที่ตรงแล้วหยุด"
        actions={
          !adding && (
            <button className="btn-gold" onClick={() => setAdding(true)}>
              <IconPlus size={18} /> เพิ่มกติกา
            </button>
          )
        }
      />

      <Section title="ทดลองพิมพ์ข้อความ" description="พิมพ์เหมือนที่ลูกค้าพิมพ์ แล้วดูว่ากติกาข้อไหนจะจับ (ไม่ส่งอะไรหาลูกค้า)">
        <form onSubmit={runTest} className="flex flex-col gap-2 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">ข้อความทดลอง</span>
            <input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="เช่น สนใจคอร์สครับ ราคาเท่าไร" />
          </label>
          <button className="btn-quiet" disabled={testText.trim() === ""}>
            ทดลอง
          </button>
        </form>
        {testResult && (
          <p role="status" className="rounded-xl p-3" style={{ background: "var(--gold-soft)", border: "1px solid var(--gold-line)" }}>
            {testResult}
          </p>
        )}
      </Section>

      {adding && (
        <Section title="เพิ่มกติกาใหม่">
          <form onSubmit={add} className="space-y-4">
            <Field label="ชื่อกติกา" hint="ตั้งให้รู้เรื่อง เช่น “ขอใบเสนอราคา”">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="จับยังไง">
                <select value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value as Rule["match_type"] })}>
                  {Object.entries(MATCH_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="จับได้แล้วทำอะไร">
                <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as Rule["action"] })}>
                  {Object.entries(ACTION_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="คำที่จะจับ">
              <input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} placeholder="เช่น ใบเสนอราคา" />
            </Field>
            {form.action === "reply" && (
              <Field label="ข้อความที่บอตตอบ">
                <textarea rows={3} value={form.reply_text} onChange={(e) => setForm({ ...form, reply_text: e.target.value })} />
              </Field>
            )}
            <Field label="ลำดับ" hint="เลขน้อยตรวจก่อน (ค่าเริ่มต้น 100)">
              <input type="number" inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="sm:max-w-[10rem]" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button className="btn-gold" disabled={busy || !form.name.trim() || !form.pattern.trim()}>
                {busy ? "กำลังบันทึก..." : "บันทึกกติกา"}
              </button>
              <button type="button" className="btn-quiet" onClick={() => setAdding(false)}>
                ยกเลิก
              </button>
            </div>
          </form>
        </Section>
      )}

      {msg && <ErrorBox message={msg} />}
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty label="ยังไม่มีกติกาในระบบ" hint="บอตจะใช้คำถามที่ถามบ่อยและฐานความรู้ตอบแทน" />}

      <ol className="space-y-2.5">
        {data?.items.map((r) => (
          <li key={r.id} className="card space-y-2 p-4" style={r.is_active ? undefined : { opacity: 0.75 }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip tnum">ลำดับ {r.priority}</span>
              <h3 className="font-semibold">{r.name}</h3>
              {!r.is_active && <span className="chip">ปิดใช้งานอยู่</span>}
              <span className="soft tnum ml-auto text-[0.88rem]">จับได้ {r.hit_count} ครั้ง</span>
            </div>
            <p className="text-[0.95rem]">
              <span className="soft">{MATCH_SHORT[r.match_type]}: </span>
              <code className="rounded-md px-1.5 py-0.5 font-sans break-all" style={{ background: "var(--bg2)" }}>
                {r.pattern}
              </code>
              <span className="soft"> → </span>
              <span className="font-medium">{ACTION_LABEL[r.action]}</span>
            </p>
            {r.reply_text && <p className="whitespace-pre-wrap">{r.reply_text}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-quiet btn-sm" onClick={() => patch(r, { is_active: !r.is_active })}>
                {r.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button className="btn-danger btn-sm ml-auto" onClick={() => remove(r)}>
                ลบ
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
