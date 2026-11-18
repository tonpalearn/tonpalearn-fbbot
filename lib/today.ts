/**
 * "งานวันนี้" ของหน้าแรกแอดมิน — ตรรกะล้วน ไม่แตะฐานข้อมูล (เทสต์ได้ตรง ๆ)
 *
 * ลำดับความสำคัญ (ต้นเคาะ 18 พ.ย. 2569):
 *   1. แชทที่รอคน (awaiting_human) + ห้องที่ต้นถือสายอยู่แต่ลูกค้าพิมพ์มาล่าสุด
 *   2. ผู้สนใจใหม่ (status = new) ที่ห้องยังไม่อยู่ในข้อ 1
 *   3. ร่างตามรอบ 2 ที่ต้นต้องส่งเอง — กำหนดส่ง = 7 วันนับจากข้อความล่าสุดของลูกค้า
 *
 * หนึ่งคน/หนึ่งห้อง ขึ้นแค่ที่เดียว (ในหมวดที่สำคัญที่สุด) แล้วติดป้ายของหมวดอื่นไว้แทน
 * จะได้ไม่เห็นชื่อเดียวกันซ้ำ 3 แถวแล้วงงว่าต้องทำ 3 อย่าง
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** หลังพ้น 24 ชม. เพจส่งได้เฉพาะข้อความที่คนพิมพ์ และไม่เกิน 7 วันนับจากข้อความล่าสุดของลูกค้า */
export const DRAFT_WINDOW_MS = 7 * DAY_MS;
/** ป้าย "ใกล้หมดเวลา" ขึ้นเมื่อเหลือไม่เกิน 2 วัน (เกณฑ์ที่ต้นกำหนด) */
export const DEADLINE_WARN_MS = 2 * DAY_MS;

export function followupDeadline(lastUserMessageAt: string | null): Date | null {
  if (!lastUserMessageAt) return null;
  const t = new Date(lastUserMessageAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + DRAFT_WINDOW_MS);
}

export type DeadlineLevel = "none" | "ok" | "soon" | "expired";

/** soon = เหลือ ≤ 2 วัน · expired = เลยแล้ว · ok = ยังมีเวลา */
export function deadlineLevel(deadline: Date | null, now: Date): DeadlineLevel {
  if (!deadline) return "none";
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return "expired";
  if (left <= DEADLINE_WARN_MS) return "soon";
  return "ok";
}

export interface TodayConversation {
  id: string;
  name: string;
  state: string;
  unread: boolean;
  lastUserMessageAt: string | null;
  lastMessage: string;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  hasDraft: boolean;
}

export interface TodayLead {
  id: string;
  name: string | null;
  conversation_id: string | null;
  segment: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  interest: string | null;
  qualification: { button?: string; fields?: Record<string, string>; reason?: string } | null;
  created_at: string;
}

export type TodayKind = "waiting" | "lead" | "draft";

export interface TodayItem {
  kind: TodayKind;
  /** เหตุผลสั้น ๆ ว่าทำไมขึ้นมาตรงนี้ */
  why: "awaiting_human" | "customer_replied" | "new_lead" | "draft";
  conversationId: string | null;
  name: string;
  state: string | null;
  unread: boolean;
  /** เวลาที่ใช้เรียง/บอก "ผ่านมากี่ชั่วโมง" — ข้อความล่าสุดของลูกค้า หรือวันที่เก็บผู้สนใจได้ */
  since: string | null;
  lastMessage: string;
  lead: TodayLead | null;
  /** กำหนดส่งร่างรอบ 2 (มีเฉพาะห้องที่มีร่าง) */
  deadline: string | null;
  deadlineLevel: DeadlineLevel;
}

export interface TodayQueue {
  waiting: TodayItem[];
  leads: TodayItem[];
  /** ร่างที่เหลือ ≤ 2 วัน — ต้องส่งวันนี้/พรุ่งนี้ */
  draftsSoon: TodayItem[];
  /** ร่างที่ยังมีเวลา — แสดงแยก ไม่ซ่อน แต่ไม่นับเป็นงานด่วน */
  draftsLater: TodayItem[];
  /** ร่างที่เลยกำหนดแล้ว ส่งทางแชทไม่ได้ — นับไว้บอกเฉย ๆ */
  draftsExpired: number;
}

const ts = (iso: string | null): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function buildTodayQueue(input: {
  conversations: TodayConversation[];
  leads: TodayLead[];
  now: Date;
}): TodayQueue {
  const { conversations, leads, now } = input;

  // ผู้สนใจใหม่ล่าสุดของแต่ละห้อง
  const leadByConvo = new Map<string, TodayLead>();
  for (const l of [...leads].sort((a, b) => ts(b.created_at) - ts(a.created_at))) {
    if (l.status !== "new") continue;
    if (l.conversation_id && !leadByConvo.has(l.conversation_id)) leadByConvo.set(l.conversation_id, l);
  }

  const deadlineOf = (c: TodayConversation) => {
    const d = c.hasDraft ? followupDeadline(c.lastUserMessageAt) : null;
    return { deadline: d ? d.toISOString() : null, deadlineLevel: deadlineLevel(d, now) };
  };

  const used = new Set<string>();
  const waiting: TodayItem[] = [];
  for (const c of conversations) {
    const replied = c.state === "human_active" && c.lastMessageSender === "user";
    if (c.state !== "awaiting_human" && !replied) continue;
    used.add(c.id);
    waiting.push({
      kind: "waiting",
      why: c.state === "awaiting_human" ? "awaiting_human" : "customer_replied",
      conversationId: c.id,
      name: c.name,
      state: c.state,
      unread: c.unread,
      since: c.lastUserMessageAt ?? c.lastMessageAt,
      lastMessage: c.lastMessage,
      lead: leadByConvo.get(c.id) ?? null,
      ...deadlineOf(c),
    });
  }
  // รอนานสุดขึ้นก่อน
  waiting.sort((a, b) => ts(a.since) - ts(b.since));

  const convoById = new Map(conversations.map((c) => [c.id, c]));
  const leadItems: TodayItem[] = [];
  for (const l of leads) {
    if (l.status !== "new") continue;
    if (l.conversation_id && used.has(l.conversation_id)) continue;
    const c = l.conversation_id ? convoById.get(l.conversation_id) : undefined;
    if (l.conversation_id) used.add(l.conversation_id);
    leadItems.push({
      kind: "lead",
      why: "new_lead",
      conversationId: l.conversation_id,
      name: l.name || c?.name || "ไม่ระบุชื่อ",
      state: c?.state ?? null,
      unread: c?.unread ?? false,
      since: l.created_at,
      lastMessage: c?.lastMessage ?? "",
      lead: l,
      ...(c ? deadlineOf(c) : { deadline: null, deadlineLevel: "none" as DeadlineLevel }),
    });
  }
  // ผู้สนใจใหม่ล่าสุดขึ้นก่อน (ยังร้อน)
  leadItems.sort((a, b) => ts(b.since) - ts(a.since));

  const draftsSoon: TodayItem[] = [];
  const draftsLater: TodayItem[] = [];
  let draftsExpired = 0;
  for (const c of conversations) {
    if (!c.hasDraft || used.has(c.id)) continue;
    const d = deadlineOf(c);
    if (d.deadlineLevel === "expired" || d.deadlineLevel === "none") {
      if (d.deadlineLevel === "expired") draftsExpired += 1;
      continue;
    }
    const item: TodayItem = {
      kind: "draft",
      why: "draft",
      conversationId: c.id,
      name: c.name,
      state: c.state,
      unread: c.unread,
      since: c.lastUserMessageAt,
      lastMessage: c.lastMessage,
      lead: null,
      ...d,
    };
    (d.deadlineLevel === "soon" ? draftsSoon : draftsLater).push(item);
  }
  // ใกล้หมดเวลาสุดขึ้นก่อน
  const byDeadline = (a: TodayItem, b: TodayItem) => ts(a.deadline) - ts(b.deadline);
  draftsSoon.sort(byDeadline);
  draftsLater.sort(byDeadline);

  return { waiting, leads: leadItems, draftsSoon, draftsLater, draftsExpired };
}

// ── ช่วงวันที่ (เวลาไทย) สำหรับตัวกรอง from–to ──────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * แปลง "YYYY-MM-DD" (วันตามปฏิทินไทย) เป็นช่วงเวลา UTC
 * from = 00:00 ของวันนั้นเวลาไทย · to = 00:00 ของวันถัดไป (ไม่รวม) → ได้ทั้งวันของวันที่ "ถึง"
 * ค่าที่ไม่ใช่รูปแบบวันที่ถูกทิ้งเงียบ ๆ (เหมือนไม่ได้กรอง) · from > to = สลับให้
 */
export function thaiDateRange(from: string | null, to: string | null): { gte: string | null; lt: string | null } {
  const toUtc = (d: string, addDays = 0) => {
    const [y, m, day] = d.split("-").map(Number);
    const t = Date.UTC(y, m - 1, day + addDays, -7, 0, 0);
    return Number.isFinite(t) && new Date(Date.UTC(y, m - 1, day)).getUTCDate() === day ? new Date(t).toISOString() : null;
  };
  let f = from && DATE_RE.test(from) ? from : null;
  let t = to && DATE_RE.test(to) ? to : null;
  if (f && t && f > t) [f, t] = [t, f];
  return { gte: f ? toUtc(f) : null, lt: t ? toUtc(t, 1) : null };
}
