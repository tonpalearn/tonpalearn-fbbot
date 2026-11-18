"use client";

import { useState } from "react";
import { IconPlus } from "@/components/icons";
import { api, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Section, thaiDate, useLoad } from "@/components/ui";

interface Doc {
  id: string;
  title: string;
  source: string | null;
  isActive: boolean;
  createdAt: string;
  chunkCount: number;
}

export default function KbPage() {
  const { data, error, loading, reload } = useLoad<{ items: Doc[] }>("/api/admin/kb");
  const [form, setForm] = useState({ title: "", source: "", content: "" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const res = await api<{ chunkCount: number }>("/api/admin/kb", { method: "POST", body: JSON.stringify(form) });
      setOkMsg(`บันทึก “${form.title}” แล้ว ตัดเป็น ${res.chunkCount} ท่อนให้บอตค้นหา`);
      setForm({ title: "", source: "", content: "" });
      setAdding(false);
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: Doc) {
    if (!confirm(`ลบเอกสาร “${doc.title}” และท่อนย่อยทั้งหมดใช่ไหมครับ (ลบแล้วกู้คืนไม่ได้)`)) return;
    try {
      await api(`/api/admin/kb/${doc.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function toggle(doc: Doc) {
    try {
      await api(`/api/admin/kb/${doc.id}`, { method: "PUT", body: JSON.stringify({ is_active: !doc.isActive }) });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        stackActions
        title="ฐานความรู้"
        subtitle="วางเนื้อหายาว ๆ ไว้ ระบบตัดเป็นท่อนให้บอตค้นแล้วเรียบเรียงตอบ — บอตอ้างได้เฉพาะที่มีในนี้ ไม่แต่งเพิ่ม"
        actions={
          !adding && (
            <button className="btn-gold" onClick={() => setAdding(true)}>
              <IconPlus size={18} /> เพิ่มเอกสาร
            </button>
          )
        }
      />

      {okMsg && <Notice>{okMsg}</Notice>}

      {adding && (
        <Section title="เพิ่มเอกสาร">
          <form onSubmit={add} className="space-y-4">
            <Field label="ชื่อเอกสาร">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น รายละเอียดคอร์ส OPB Builder" />
            </Field>
            <Field label="ที่มา" hint="ไม่บังคับ — ชื่อไฟล์หรือลิงก์ ไว้ย้อนดูทีหลัง">
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </Field>
            <Field label="เนื้อหา" hint={`วางทั้งหมดได้เลย ระบบตัดท่อนให้เอง · ตอนนี้ ${form.content.length.toLocaleString("th-TH")} ตัวอักษร`}>
              <textarea rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button className="btn-gold" disabled={busy || !form.title.trim() || !form.content.trim()}>
                {busy ? "กำลังบันทึกและตัดท่อน..." : "บันทึกเอกสาร"}
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
      {data && data.items.length === 0 && (
        <Empty label="ยังไม่มีเอกสารในฐานความรู้" hint="ตอนนี้บอตตอบได้แค่จากกติกาและคำถามที่ถามบ่อย" />
      )}

      <ul className="space-y-2.5">
        {data?.items.map((d) => (
          <li key={d.id} className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-4" style={d.isActive ? undefined : { opacity: 0.75 }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{d.title}</h3>
                {!d.isActive && <span className="chip">ปิดใช้งานอยู่</span>}
              </div>
              <p className="soft text-[0.9rem]">
                <span className="tnum">{d.chunkCount} ท่อน</span> · เพิ่มเมื่อ {thaiDate(d.createdAt)}
                {d.source && ` · ที่มา: ${d.source}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-quiet btn-sm" onClick={() => toggle(d)}>
                {d.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button className="btn-danger btn-sm" onClick={() => remove(d)}>
                ลบ
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
