"use client";

import { useState } from "react";
import { IconAlert, IconPlus } from "@/components/icons";
import { api, Empty, ErrorBox, Field, Loading, PageHeader, Section, useLoad } from "@/components/ui";

interface Faq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  is_active: boolean;
  hit_count: number;
}

const PLACEHOLDER = "[กรอกเอง]";
const splitKeywords = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function FaqPage() {
  const { data, error, loading, reload } = useLoad<{ items: Faq[] }>("/api/admin/faq");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ question: "", answer: "", keywords: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/faq", {
        method: "POST",
        body: JSON.stringify({ question: form.question, answer: form.answer, keywords: splitKeywords(form.keywords) }),
      });
      setForm({ question: "", answer: "", keywords: "" });
      setAdding(false);
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
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    }
  }

  async function remove(item: Faq) {
    if (!confirm(`ลบคำถาม “${item.question}” ใช่ไหมครับ (ลบแล้วกู้คืนไม่ได้)`)) return;
    try {
      await api(`/api/admin/faq/${item.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const notFilled = data?.items.filter((i) => i.answer.startsWith(PLACEHOLDER)).length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        stackActions
        title="คำถามที่ถามบ่อย"
        subtitle="บอตหยิบคำตอบตรงนี้ก่อนเรียก AI — กรอกครบ บอตตอบไวขึ้นและค่าใช้จ่ายถูกลง"
        actions={
          !adding && (
            <button className="btn-gold" onClick={() => setAdding(true)}>
              <IconPlus size={18} /> เพิ่มคำถาม
            </button>
          )
        }
      />

      {notFilled > 0 && (
        <div className="card flex gap-3 p-4" role="note" style={{ borderColor: "var(--amber-line)", background: "var(--amber-soft)" }}>
          <span className="mt-0.5" style={{ color: "var(--amber)" }}>
            <IconAlert />
          </span>
          <div>
            <p className="font-medium" style={{ color: "var(--amber)" }}>
              ยังมี {notFilled} ข้อที่เป็นโครงตัวอย่าง (ขึ้นต้นด้วย {PLACEHOLDER})
            </p>
            <p className="text-[0.95rem]">บอตจะไม่เอาคำตอบเหล่านี้ไปตอบลูกค้า แต่จะส่งต่อให้คนตอบทุกครั้ง — กรอกของจริงก่อนเปิดใช้</p>
          </div>
        </div>
      )}

      {adding && (
        <Section title="เพิ่มคำถามใหม่">
          <form onSubmit={add} className="space-y-4">
            <FaqFields value={form} onChange={setForm} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-gold" disabled={busy || !form.question.trim() || !form.answer.trim()}>
                {busy ? "กำลังบันทึก..." : "บันทึกคำถาม"}
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
        <Empty label="ยังไม่มีคำถามในระบบ" hint="เริ่มจากคำถามที่ลูกค้าถามซ้ำบ่อยที่สุด เช่น ราคา หรือ เรียนที่ไหน" />
      )}

      <div className="space-y-2.5">
        {data?.items.map((item) => (
          <FaqCard key={item.id} item={item} onSave={save} onRemove={remove} />
        ))}
      </div>
    </div>
  );
}

function FaqFields({
  value,
  onChange,
}: {
  value: { question: string; answer: string; keywords: string };
  onChange: (v: { question: string; answer: string; keywords: string }) => void;
}) {
  return (
    <>
      <Field label="คำถาม">
        <input value={value.question} onChange={(e) => onChange({ ...value, question: e.target.value })} placeholder="เช่น คอร์สนี้ราคาเท่าไร" />
      </Field>
      <Field label="คำตอบ" hint="เขียนเป็นคำที่บอตจะพูดกับลูกค้าได้เลย (เสียง “ผม”)">
        <textarea rows={4} value={value.answer} onChange={(e) => onChange({ ...value, answer: e.target.value })} />
      </Field>
      <Field label="คำสำคัญ" hint="คั่นด้วยจุลภาค เช่น ราคา, เท่าไร, ค่าเรียน">
        <input value={value.keywords} onChange={(e) => onChange({ ...value, keywords: e.target.value })} />
      </Field>
    </>
  );
}

function FaqCard({
  item,
  onSave,
  onRemove,
}: {
  item: Faq;
  onSave: (item: Faq, patch: Partial<Faq>) => Promise<boolean>;
  onRemove: (item: Faq) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ question: item.question, answer: item.answer, keywords: item.keywords.join(", ") });
  const needsFilling = item.answer.startsWith(PLACEHOLDER);

  if (editing) {
    return (
      <form
        className="card space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await onSave(item, { question: form.question, answer: form.answer, keywords: splitKeywords(form.keywords) });
          if (ok) setEditing(false);
        }}
      >
        <FaqFields value={form} onChange={setForm} />
        <div className="flex gap-2">
          <button className="btn-gold">บันทึก</button>
          <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>
            ยกเลิก
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="card space-y-2 p-4" style={item.is_active ? undefined : { opacity: 0.75 }}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{item.question}</h3>
        {needsFilling && <span className="chip chip-amber">ยังไม่ได้กรอก</span>}
        {!item.is_active && <span className="chip">ปิดใช้งานอยู่</span>}
        <span className="soft tnum ml-auto text-[0.88rem]">ใช้ตอบ {item.hit_count} ครั้ง</span>
      </div>
      <p className="whitespace-pre-wrap">{item.answer}</p>
      {item.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.keywords.map((k) => (
            <span key={k} className="chip text-[0.8rem]">
              {k}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button className="btn-quiet btn-sm" onClick={() => setEditing(true)}>
          แก้ไข
        </button>
        <button className="btn-quiet btn-sm" onClick={() => onSave(item, { is_active: !item.is_active })}>
          {item.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
        </button>
        <button className="btn-danger btn-sm ml-auto" onClick={() => onRemove(item)}>
          ลบ
        </button>
      </div>
    </article>
  );
}
