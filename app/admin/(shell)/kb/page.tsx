"use client";

import { useState } from "react";
import { api, Empty, ErrorBox, Field, Loading, thaiTime, useLoad } from "@/components/ui";

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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const res = await api<{ chunkCount: number }>("/api/admin/kb", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setOkMsg(`บันทึกแล้ว ตัดเป็น ${res.chunkCount} ท่อนให้บอตค้นหา`);
      setForm({ title: "", source: "", content: "" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: Doc) {
    if (!confirm(`ลบเอกสาร “${doc.title}” และท่อนย่อยทั้งหมดใช่ไหมครับ`)) return;
    try {
      await api(`/api/admin/kb/${doc.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function toggle(doc: Doc) {
    try {
      await api(`/api/admin/kb/${doc.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !doc.isActive }),
      });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">ฐานความรู้</h1>
      <p className="soft">
        วางเนื้อหายาว ๆ ไว้ตรงนี้ ระบบจะตัดเป็นท่อนให้บอตค้นหาแล้วเอาไปเรียบเรียงตอบ —
        บอตจะอ้างได้เฉพาะเนื้อหาที่มีอยู่จริงในนี้เท่านั้น ไม่แต่งเพิ่มเอง
      </p>

      <form onSubmit={add} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">เพิ่มเอกสาร</h2>
        <Field label="ชื่อเอกสาร">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="เช่น รายละเอียดคอร์ส OPB Builder"
          />
        </Field>
        <Field label="ที่มา" hint="ใส่หรือไม่ใส่ก็ได้ เช่น ชื่อไฟล์ หรือลิงก์">
          <input
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
        </Field>
        <Field label="เนื้อหา">
          <textarea
            rows={10}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="วางเนื้อหาทั้งหมดได้เลย ระบบจะตัดท่อนให้เอง"
          />
        </Field>
        <button className="btn-gold" disabled={busy}>
          {busy ? "กำลังบันทึกและตัดท่อน..." : "บันทึกเอกสาร"}
        </button>
        {okMsg && <p style={{ color: "#2f7d5d" }}>{okMsg}</p>}
      </form>

      {msg && <ErrorBox message={msg} />}
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty label="ยังไม่มีเอกสารในฐานความรู้ — บอตจะตอบได้แค่จากกติกาและคำถามที่ถามบ่อย" />
      )}

      <div className="space-y-3">
        {data?.items.map((d) => (
          <div key={d.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.title}</span>
              {!d.isActive && <span className="soft text-[0.85rem]">ปิดใช้งานอยู่</span>}
              <span className="soft ml-auto text-[0.85rem]">
                {d.chunkCount} ท่อน · {thaiTime(d.createdAt)}
              </span>
            </div>
            {d.source && <p className="soft text-[0.9rem]">ที่มา: {d.source}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-quiet" onClick={() => toggle(d)}>
                {d.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button className="btn-quiet" onClick={() => remove(d)}>
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
