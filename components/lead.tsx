"use client";

/**
 * ชิ้นส่วนสรุปผู้สนใจ — ใช้ร่วมกันทั้งหน้างานวันนี้ หน้าแชท และหน้าผู้สนใจ (การ์ดมือถือ + ตารางจอใหญ่)
 * แยกเป็นชิ้นเดียวกันกันข้อมูลหลุดไปแบบใดแบบหนึ่ง (feedback_thai_ui_readability ข้อ 3)
 */
import { ContactActions, FIELD_LABEL, SegmentChip, contactText, type ContactBits } from "./ui";

export interface LeadLike extends ContactBits {
  name: string | null;
  interest: string | null;
  segment: string | null;
  qualification: { button?: string; fields?: Record<string, string>; reason?: string } | null;
}

/** ปุ่มที่กด · ธุรกิจ · ปัญหา — สามอย่างที่ต้นต้องรู้ก่อนทักกลับ */
export function leadFacts(l: LeadLike) {
  const f = l.qualification?.fields ?? {};
  return {
    button: l.qualification?.button ?? null,
    business: f.business_type ?? null,
    pain: f.pain ?? f.task ?? f.use_case ?? l.interest ?? null,
    task: f.pain && f.task ? f.task : null,
    slot: f.slot ?? null,
    reason: l.qualification?.reason ?? null,
    extra: Object.entries(f).filter(
      ([k, v]) => v && k in FIELD_LABEL && !["business_type", "pain", "task", "use_case", "slot", "contact"].includes(k),
    ),
  };
}

/** บรรทัดสรุปสั้น (ใช้ในรายการ) */
export function LeadLine({ lead }: { lead: LeadLike }) {
  const f = leadFacts(lead);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {f.button && <span className="chip chip-gold">กด “{f.button}”</span>}
        <SegmentChip segment={lead.segment} />
      </div>
      {(f.business || f.pain) && (
        <p className="text-[0.95rem]">
          {f.business && <span className="font-medium">{f.business}</span>}
          {f.business && f.pain && <span className="soft"> · </span>}
          {f.pain && <span>{f.pain}</span>}
        </p>
      )}
      {contactText(lead) && <p className="soft text-[0.92rem]">ติดต่อ: {contactText(lead)}</p>}
    </div>
  );
}

/** การ์ดสรุปเต็ม (หัวหน้าแชท) */
export function LeadFacts({ lead }: { lead: LeadLike }) {
  const f = leadFacts(lead);
  const rows: [string, string | null][] = [
    ["ปุ่มที่กด", f.button],
    ["ธุรกิจ", f.business],
    ["ปัญหา / ตรงไหนกินเวลา", f.pain],
    ["อยากให้ AI ช่วยงาน", f.task],
    ["เวลานัดที่เลือก", f.slot],
    ...f.extra.map(([k, v]) => [FIELD_LABEL[k], v] as [string, string]),
    ["ส่งต่อเพราะ", f.reason],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="soft text-[0.85rem]">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
      </dl>
      <div>
        <p className="soft mb-1 text-[0.85rem]">ช่องทางติดต่อ</p>
        <ContactActions lead={lead} />
      </div>
    </div>
  );
}
