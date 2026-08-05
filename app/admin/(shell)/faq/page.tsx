"use client";

import { useState } from "react";
import { api, Empty, ErrorBox, Field, Loading, useLoad } from "@/components/ui";

interface Faq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  is_active: boolean;
  hit_count: number;
}

const PLACEHOLDER = "[กรอกเอง]";

export default function FaqPage() {
  const { data, error, loading, reload } = useLoad<{ items: Faq[] }>("/api/admin/faq");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", answer: "", keywords: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/faq", {
        method: "POST",
        body: JSON.stringify({
          question: form.question,
          answer: form.answer,
          keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      setForm({ question: "", answer: "", keywords: "" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(item: Faq, patch: Partial<Faq>) {
    setMsg(null);
    try {
      await api(`/api/admin/faq/${item.id}`, { method: "PUT", body: JSON.stringify(patch) });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function remove(item: Faq) {
    if (!confirm(`ลบคำถาม “${item.question}” ใช่ไหมครับ`)) return;
    try {
      await api(`/api/admin/faq/${item.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const notFilled = data?.items.filter((i) => i.answer.startsWith(PLACEHOLDER)).length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">คำถามที่ถามบ่อย</h1>
      <p className="soft">
        บอตจะหยิบคำตอบตรงนี้ไปตอบก่อนเรียกโมเดล — ยิ่งกรอกครบ ยิ่งตอบไว และค่าใช้จ่ายยิ่งถูก
      </p>

      {notFilled > 0 && (
        <div className="card p-4" style={{ borderColor: "#b4691a" }}>
          <p style={{ color: "#b4691a" }}>
            ยังมี {notFilled} ข้อที่เป็นโครงตัวอย่าง (ขึ้นต้นด้วย {PLACEHOLDER})
          </p>
          <p className="soft mt-1 text-[0.95rem]">
            บอตจะไม่เอาคำตอบเหล่านี้ไปตอบลูกค้า แต่จะโยนให้คนตอบแทนทุกครั้ง — กรอกของจริงก่อนเปิดใช้ครับ
          </p>
        </div>
      )}

      <form onSubmit={add} className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">เพิ่มคำถามใหม่</h2>
        <Field label="คำถาม">
          <input
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="เช่น คอร์สนี้ราคาเท่าไร"
          />
        </Field>
        <Field label="คำตอบ">
          <textarea
            rows={3}
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            placeholder="ตอบเป็นภาษาที่บอตจะพูดกับลูกค้าได้เลย"
          />
        </Field>
        <Field label="คำสำคัญ" hint="คั่นด้วยจุลภาค เช่น ราคา, เท่าไร, ค่าเรียน">
          <input
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
        </Field>
        <button className="btn-gold" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "เพิ่มคำถาม"}
        </button>
      </form>

      {msg && <ErrorBox message={msg} />}
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty label="ยังไม่มีคำถามในระบบ" />}

      <div className="space-y-3">
        {data?.items.map((item) => (
          <FaqCard key={item.id} item={item} onSave={save} onRemove={remove} />
        ))}
      </div>
    </div>
  );
}

function FaqCard({
  item,
  onSave,
  onRemove,
}: {
  item: Faq;
  onSave: (item: Faq, patch: Partial<Faq>) => Promise<void>;
  onRemove: (item: Faq) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);
  const [keywords, setKeywords] = useState(item.keywords.join(", "));
  const needsFilling = item.answer.startsWith(PLACEHOLDER);

  return (
    <div className="card space-y-2 p-4">
      {editing ? (
        <>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
          <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="คำสำคัญ คั่นด้วยจุลภาค"
          />
          <div className="flex gap-2">
            <button
              className="btn-gold"
              onClick={async () => {
                await onSave(item, {
                  question,
                  answer,
                  keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean) as string[],
                });
                setEditing(false);
              }}
            >
              บันทึก
            </button>
            <button className="btn-quiet" onClick={() => setEditing(false)}>
              ยกเลิก
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.question}</p>
            {needsFilling && (
              <span
                className="rounded-full px-2 py-0.5 text-[0.8rem]"
                style={{ background: "#f6e2cc", color: "#8a4d0d" }}
              >
                ยังไม่ได้กรอก
              </span>
            )}
            {!item.is_active && <span className="soft text-[0.85rem]">ปิดใช้งานอยู่</span>}
            <span className="soft ml-auto text-[0.85rem]">ใช้ไป {item.hit_count} ครั้ง</span>
          </div>
          <p className="soft whitespace-pre-wrap">{item.answer}</p>
          {item.keywords.length > 0 && (
            <p className="soft text-[0.9rem]">คำสำคัญ: {item.keywords.join(" · ")}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn-quiet" onClick={() => setEditing(true)}>
              แก้ไข
            </button>
            <button
              className="btn-quiet"
              onClick={() => onSave(item, { is_active: !item.is_active })}
            >
              {item.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            </button>
            <button className="btn-quiet" onClick={() => onRemove(item)}>
              ลบ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
