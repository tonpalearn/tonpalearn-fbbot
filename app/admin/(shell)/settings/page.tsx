"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlert, IconCheck, IconX } from "@/components/icons";
import { api, ErrorBox, Field, Loading, Notice, PageHeader, Section, useLoad } from "@/components/ui";
import { usableSlots } from "@/lib/qualifier";

interface SettingItem {
  key: string;
  label: string;
  text: string;
}

interface SettingsResponse {
  items: SettingItem[];
  botEnabled: boolean;
  pageRegistered: boolean;
}

/** ชื่อช่องสั้น + คำอธิบาย (ป้ายจาก API ยาวเกินจะอ่านบนมือถือ) */
const COPY: Record<string, { label: string; hint: string; rows: number }> = {
  greeting: { label: "ข้อความทักทาย", hint: "ส่งตอนลูกค้ากด “เริ่มต้น” ครั้งแรก", rows: 3 },
  fallback: { label: "เมื่อบอตตอบไม่ได้", hint: "บอตจะส่งต่อให้ต้นพร้อมข้อความนี้", rows: 3 },
  handoff_notice: { label: "ตอนส่งต่อให้คน", hint: "บอกลูกค้าว่าต้นจะเข้ามาตอบเอง", rows: 3 },
  consent_notice: { label: "ขออนุญาตเก็บข้อมูล", hint: "ส่งก่อนขอเบอร์/LINE (PDPA)", rows: 3 },
  office_hours: { label: "เวลาทำการ", hint: "โฟลว์แอดตอนนี้ไม่ได้ใช้ช่องนี้", rows: 1 },
  bot_persona: { label: "บุคลิกของบอต", hint: "ใช้สั่ง AI เท่านั้น ลูกค้าไม่เห็นข้อความนี้ตรง ๆ", rows: 4 },
};

const GROUPS: { title: string; description: string; keys: string[] }[] = [
  { title: "ข้อความที่บอตพูดกับลูกค้า", description: "เขียนด้วยเสียงของเพจได้เลย บอตใช้ข้อความเหล่านี้ตรง ๆ", keys: ["greeting", "fallback", "handoff_notice", "consent_notice"] },
  { title: "ขั้นสูง", description: "แก้ไม่บ่อย", keys: ["office_hours", "bot_persona"] },
];

const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** ตัวอย่างช่องเวลา 2 ช่องที่ชื่อวันตรงกับวันที่จริง (คำนวณจากวันนี้ เวลาไทย) */
function exampleSlots(now = new Date()): string[] {
  const bkk = new Date(now.getTime() + 7 * 3600_000);
  const pick = (weekday: number, time: string) => {
    for (let i = 1; i <= 14; i += 1) {
      const d = new Date(bkk.getTime() + i * 86400_000);
      if (d.getUTCDay() === weekday) return { at: d.getTime(), text: `${TH_DAYS[weekday]} ${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${time}` };
    }
    return { at: 0, text: "" };
  };
  return [pick(2, "10:00"), pick(5, "14:00")].sort((a, b) => a.at - b.at).map((s) => s.text);
}

export default function SettingsPage() {
  const { data, error, loading, reload } = useLoad<SettingsResponse>("/api/admin/settings");
  const [items, setItems] = useState<SettingItem[]>([]);
  const [botEnabled, setBotEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setItems(data.items);
      setBotEnabled(data.botEnabled);
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    if (data.botEnabled !== botEnabled) return true;
    return items.some((i) => data.items.find((d) => d.key === i.key)?.text !== i.text);
  }, [data, items, botEnabled]);

  function setText(key: string, text: string) {
    setOkMsg(null);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, text } : i)));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ items: items.map((i) => ({ key: i.key, text: i.text })), botEnabled }),
      });
      setOkMsg("บันทึกเรียบร้อยแล้ว");
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const byKey = new Map(items.map((i) => [i.key, i]));
  const slots = byKey.get("meeting_slots");

  return (
    <div className="space-y-5">
      <PageHeader title="ตั้งค่า" subtitle="แก้แล้วกด “บันทึก” ด้านล่างครั้งเดียว" />

      <Section title="สวิตช์บอต">
        <div className="flex items-center gap-4">
          <button
            type="button"
            role="switch"
            aria-checked={botEnabled}
            aria-labelledby="bot-switch-label"
            className="switch"
            onClick={() => {
              setOkMsg(null);
              setBotEnabled(!botEnabled);
            }}
          />
          <div id="bot-switch-label">
            <p className="font-medium">{botEnabled ? "บอตตอบอัตโนมัติอยู่" : "ปิดบอตทั้งเพจ"}</p>
            <p className="soft text-[0.92rem]">
              {botEnabled ? "ปิดเมื่ออยากตอบเองทุกแชท" : "ทุกข้อความจะไม่มีการตอบอัตโนมัติ ต้นต้องตอบเองใน Business Suite"}
            </p>
          </div>
        </div>
        {data && !data.pageRegistered && (
          <p className="text-[0.95rem]" style={{ color: "var(--amber)" }}>
            ยังไม่มีข้อมูลเพจนี้ในฐานข้อมูล — กดบันทึกครั้งแรกระบบจะสร้างให้ (ดูขั้นตอนใน docs/DEPLOY.md)
          </p>
        )}
      </Section>

      {slots && <SlotsField value={slots.text} onChange={(t) => setText("meeting_slots", t)} />}

      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} description={g.description}>
          {g.keys
            .map((k) => byKey.get(k))
            .filter((i): i is SettingItem => Boolean(i))
            .map((item) => {
              const c = COPY[item.key] ?? { label: item.label, hint: "", rows: 2 };
              return (
                <Field key={item.key} label={c.label} hint={c.hint}>
                  <textarea rows={c.rows} value={item.text} onChange={(e) => setText(item.key, e.target.value)} />
                </Field>
              );
            })}
        </Section>
      ))}

      {msg && <ErrorBox message={msg} />}

      {/* ปุ่มบันทึกติดล่างจอ เห็นตลอดเวลามีของที่ยังไม่บันทึก */}
      <div
        className="card sticky bottom-[calc(62px+env(safe-area-inset-bottom,0px))] z-20 flex flex-wrap items-center gap-3 p-3 lg:bottom-3"
        style={{ boxShadow: "var(--shadow-m)" }}
      >
        <button className="btn-gold" onClick={save} disabled={busy || !dirty}>
          {busy ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}
        </button>
        {okMsg ? <Notice>{okMsg}</Notice> : <span className="soft text-[0.92rem]">{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : "ยังไม่มีการแก้ไข"}</span>}
      </div>
    </div>
  );
}

/** ช่องเวลาว่างนัดคุย — ตรวจทีละบรรทัดด้วยตัวเดียวกับที่บอตใช้ (usableSlots) */
function SlotsField({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const examples = useMemo(() => exampleSlots(), []);
  const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
  // usableSlots ต้องได้ 2 ช่อง — ตรวจทีละบรรทัดด้วยการส่งบรรทัดเดียวกัน 2 ครั้ง
  const checks = lines.map((l) => ({ line: l, ok: usableSlots(`${l}\n${l}`).length === 2 }));
  const offered = usableSlots(value);

  return (
    <Section title="ช่องเวลาว่างนัดคุย 30 นาที" description="บอตเสนอ 2 ช่องแรกที่ยังไม่ผ่านให้ลูกค้าเลือก · ได้ไม่ถึง 2 ช่อง = ทุกคำขอนัดส่งต่อให้ต้น">
      <Field
        label="ช่องเวลา (บรรทัดละ 1 ช่อง)"
        hint={
          <>
            รูปแบบ <b>ชื่อวัน วันที่ เดือน เวลา</b> — ชื่อวันต้องตรงกับวันที่จริง ไม่งั้นบอตข้ามช่องนั้น
          </>
        }
      >
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={examples.join("\n")} />
      </Field>

      <div className="card-quiet flex flex-wrap items-center gap-2 px-3 py-2 text-[0.92rem]">
        <span className="soft">ตัวอย่างที่ใช้ได้ (ชื่อวันตรงกับวันที่):</span>
        {examples.map((e) => (
          <code key={e} className="rounded-md px-1.5 font-sans" style={{ background: "var(--bg2)" }}>
            {e}
          </code>
        ))}
        <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(examples.join("\n"))}>
          ใส่ตัวอย่างนี้
        </button>
      </div>

      {lines.length > 0 && (
        <ul className="space-y-1" aria-label="ผลตรวจแต่ละช่อง">
          {checks.map((c, i) => (
            <li key={`${c.line}-${i}`} className="flex items-center gap-2 text-[0.95rem]">
              <span style={{ color: c.ok ? "var(--teal)" : "var(--red)" }}>{c.ok ? <IconCheck size={18} /> : <IconX size={18} />}</span>
              <span>{c.line}</span>
              {!c.ok && <span className="soft text-[0.88rem]">— ใช้ไม่ได้: อ่านวันที่ไม่ออก ชื่อวันไม่ตรงวันที่ หรือเลยไปแล้ว</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-2 text-[0.95rem] font-medium" style={{ color: offered.length === 2 ? "var(--teal)" : "var(--amber)" }}>
        {offered.length === 2 ? <IconCheck size={18} /> : <IconAlert size={18} />}
        {offered.length === 2 ? `บอตจะเสนอ: ${offered.join(" หรือ ")}` : "ตอนนี้ยังไม่ถึง 2 ช่อง — บอตจะไม่เสนอเวลา ส่งคำขอนัดต่อให้ต้นทุกครั้ง"}
      </p>
    </Section>
  );
}
