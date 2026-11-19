/**
 * ชั้นอ่าน/เขียนฐานข้อมูลของ "หน้าแอดมิน" โดยเฉพาะ
 *
 * ทำไมไม่ใส่ใน lib/store.ts: store.ts เป็นของฝั่งบอต (PM สั่งห้ามแก้ของเดิม)
 * ไฟล์นี้จึงเป็นชั้นข้อมูลของฝั่งแอดมิน แต่ยังยึดกฎเดิมคือ
 * เข้าถึง Supabase ผ่าน db() จาก lib/supabase.ts เท่านั้น
 * และหน้าเว็บห้ามเรียกไฟล์นี้ตรง ๆ ต้องผ่าน /api/admin/* เสมอ
 */
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import type { ConversationState } from "@/lib/store";

export function pageId(): string {
  return env.fb.pageId();
}

/** สถานะบทสนทนาที่ยอมรับได้ — ใช้ตรวจค่าที่ส่งมาจากหน้าเว็บ */
export const CONVERSATION_STATES: ConversationState[] = [
  "bot_active",
  "collecting_lead",
  "awaiting_human",
  "human_active",
  "closed",
];

export function isConversationState(v: string): v is ConversationState {
  return (CONVERSATION_STATES as string[]).includes(v);
}

// ── บทสนทนา ────────────────────────────────────────────────────────────

interface RawContact {
  first_name?: string | null;
  last_name?: string | null;
  psid?: string | null;
  profile_pic?: string | null;
}

interface RawConversation {
  id: string;
  state: ConversationState;
  unread_for_admin: boolean;
  last_user_message_at: string | null;
  updated_at: string;
  contact: RawContact | RawContact[] | null;
}

export interface ConversationSummary {
  id: string;
  state: ConversationState;
  unread: boolean;
  lastUserMessageAt: string | null;
  updatedAt: string;
  name: string;
  /** ลิงก์รูปโปรไฟล์ Messenger (หมดอายุได้ — หน้าเว็บต้องมีตัวอักษรแทนเมื่อโหลดไม่ขึ้น) */
  avatar: string | null;
  lastMessage: string;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  /** มีร่างตามรอบ 2 รอต้นส่งเอง (migration 0004 — ยังไม่รันก็เป็น false) */
  hasDraft: boolean;
}

export interface MessageRow {
  id: string;
  direction: "in" | "out";
  sender: "user" | "bot" | "admin" | "system";
  content: string | null;
  answerSource: string | null;
  confidence: number | null;
  createdAt: string;
}

/** ความสัมพันธ์แบบ "หลายต่อหนึ่ง" ปกติคืนเป็นอ็อบเจกต์ แต่กันไว้เผื่อคืนเป็นอาเรย์ */
function pickContact(c: RawContact | RawContact[] | null): RawContact | null {
  if (Array.isArray(c)) return c[0] ?? null;
  return c ?? null;
}

export function displayName(c: RawContact | null): string {
  const full = `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim();
  if (full !== "") return full;
  const psid = c?.psid ?? "";
  return psid !== "" ? `ผู้ใช้ ...${psid.slice(-6)}` : "ผู้ใช้ที่ไม่ทราบชื่อ";
}

/** ดึงข้อความล่าสุดของแต่ละบทสนทนาในคำสั่งเดียว ไม่ยิงทีละห้อง */
async function lastMessages(
  ids: string[],
): Promise<Map<string, { content: string | null; sender: string; created_at: string }>> {
  const map = new Map<string, { content: string | null; sender: string; created_at: string }>();
  if (ids.length === 0) return map;

  const { data, error } = await db()
    .from("messages")
    .select("conversation_id,content,sender,created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(Math.min(ids.length * 20, 1500));
  if (error) throw error;

  for (const row of (data ?? []) as unknown as {
    conversation_id: string;
    content: string | null;
    sender: string;
    created_at: string;
  }[]) {
    if (!map.has(row.conversation_id)) {
      map.set(row.conversation_id, {
        content: row.content,
        sender: row.sender,
        created_at: row.created_at,
      });
    }
  }
  return map;
}

export async function listConversations(opts: {
  state?: ConversationState;
  limit: number;
}): Promise<ConversationSummary[]> {
  let q = db()
    .from("conversations")
    .select(
      "id,state,unread_for_admin,last_user_message_at,updated_at,contact:contacts(first_name,last_name,psid,profile_pic)",
    )
    .eq("page_id", pageId())
    .order("updated_at", { ascending: false })
    .limit(opts.limit);

  if (opts.state) q = q.eq("state", opts.state);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawConversation[];
  const ids = rows.map((r) => r.id);
  const [last, drafts] = await Promise.all([lastMessages(ids), draftIds(ids)]);

  return rows.map((r) => {
    const lm = last.get(r.id);
    return {
      id: r.id,
      state: r.state,
      unread: r.unread_for_admin,
      lastUserMessageAt: r.last_user_message_at,
      updatedAt: r.updated_at,
      name: displayName(pickContact(r.contact)),
      avatar: pickContact(r.contact)?.profile_pic ?? null,
      lastMessage: lm?.content ?? "",
      lastMessageSender: lm?.sender ?? null,
      lastMessageAt: lm?.created_at ?? null,
      hasDraft: drafts.has(r.id),
    };
  });
}

/** ห้องไหนมีร่างตามรอบ 2 — อ่านแยก ถ้ายังไม่รัน 0004 ก็คืนชุดว่าง ไม่ทำให้กล่องข้อความพัง */
async function draftIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db()
    .from("conversations")
    .select("id,followup_draft")
    .in("id", ids)
    .not("followup_draft", "is", null);
  if (error) return new Set();
  return new Set(
    ((data ?? []) as unknown as { id: string; followup_draft: string | null }[])
      .filter((r) => (r.followup_draft ?? "").trim() !== "")
      .map((r) => r.id),
  );
}

export interface ConversationDetail {
  id: string;
  state: ConversationState;
  name: string;
  avatar: string | null;
  psid: string;
  lastUserMessageAt: string | null;
  messages: MessageRow[];
  /** migration 0004 — ร่างตามรอบ 2 ที่บอตห้ามส่งเอง + การตามอัตโนมัติ */
  followup: {
    draft: string | null;
    draftAt: string | null;
    sentAt: string | null;
    variant: string | null;
  };
  /** ผู้สนใจล่าสุดที่ผูกกับห้องนี้ (ไว้ทำการ์ดสรุปบนหัวหน้าแชท) · ไม่มี = null */
  lead: LeadSummary | null;
}

export interface LeadSummary {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  interest: string | null;
  status: string;
  segment: string | null;
  qualification: { button?: string; fields?: Record<string, string>; reason?: string } | null;
  created_at: string;
}

const LEAD_COLS_FULL = "id,name,phone,email,line_id,interest,status,segment,qualification,created_at";
const LEAD_COLS_LEGACY = "id,name,phone,email,interest,status,created_at";

/** ผู้สนใจล่าสุดของห้อง — ถ้ายังไม่รัน 0003 ถอยไปอ่านคอลัมน์ชุดเดิม · พังทั้งคู่ = null (หน้าแชทต้องเปิดได้เสมอ) */
async function latestLeadOf(conversationId: string): Promise<LeadSummary | null> {
  const run = (cols: string) =>
    db()
      .from("leads")
      .select(cols)
      .eq("conversation_id", conversationId)
      .eq("page_id", pageId())
      .order("created_at", { ascending: false })
      .limit(1);
  let res = await run(LEAD_COLS_FULL);
  if (res.error) res = await run(LEAD_COLS_LEGACY);
  if (res.error) return null;
  const row = ((res.data ?? []) as unknown as Partial<LeadSummary>[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    line_id: row.line_id ?? null,
    interest: row.interest ?? null,
    status: row.status ?? "new",
    segment: row.segment ?? null,
    qualification: row.qualification ?? null,
    created_at: String(row.created_at),
  };
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const { data, error } = await db()
    .from("conversations")
    .select(
      "id,state,last_user_message_at,contact:contacts(first_name,last_name,psid,profile_pic)",
    )
    .eq("id", id)
    .eq("page_id", pageId())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as RawConversation;
  const contact = pickContact(row.contact);

  // ช่องตามต่อ (0004) อ่านแยก — ยังไม่รัน migration ก็เปิดหน้าแชทได้ตามเดิม
  const fu = await db()
    .from("conversations")
    .select("followup_draft,followup_draft_at,followup_sent_at,followup_variant")
    .eq("id", id)
    .maybeSingle();
  const fuRow = (fu.error ? null : fu.data) as {
    followup_draft: string | null;
    followup_draft_at: string | null;
    followup_sent_at: string | null;
    followup_variant: string | null;
  } | null;

  const msgs = await db()
    .from("messages")
    .select("id,direction,sender,content,answer_source,confidence,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (msgs.error) throw msgs.error;
  const lead = await latestLeadOf(id);

  const messages = ((msgs.data ?? []) as unknown as {
    id: string;
    direction: "in" | "out";
    sender: "user" | "bot" | "admin" | "system";
    content: string | null;
    answer_source: string | null;
    confidence: number | string | null;
    created_at: string;
  }[]).map((m) => ({
    id: m.id,
    direction: m.direction,
    sender: m.sender,
    content: m.content,
    answerSource: m.answer_source,
    confidence: m.confidence === null ? null : Number(m.confidence),
    createdAt: m.created_at,
  }));

  return {
    id: row.id,
    state: row.state,
    name: displayName(contact),
    avatar: contact?.profile_pic ?? null,
    psid: contact?.psid ?? "",
    lastUserMessageAt: row.last_user_message_at,
    messages,
    followup: {
      draft: fuRow?.followup_draft ?? null,
      draftAt: fuRow?.followup_draft_at ?? null,
      sentAt: fuRow?.followup_sent_at ?? null,
      variant: fuRow?.followup_variant ?? null,
    },
    lead,
  };
}

/** คืน psid ไว้ใช้ส่งข้อความผ่าน Facebook — คืน null ถ้าไม่พบบทสนทนาของเพจนี้ */
export async function getConversationPsid(
  id: string,
): Promise<{ psid: string; lastUserMessageAt: string | null } | null> {
  const { data, error } = await db()
    .from("conversations")
    .select("id,last_user_message_at,contact:contacts(psid)")
    .eq("id", id)
    .eq("page_id", pageId())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as RawConversation;
  const psid = pickContact(row.contact)?.psid ?? "";
  if (psid === "") return null;
  return { psid, lastUserMessageAt: row.last_user_message_at };
}

export async function markConversationRead(id: string): Promise<void> {
  await db().from("conversations").update({ unread_for_admin: false }).eq("id", id);
}

// ── ตัวเลขหน้าแรก ───────────────────────────────────────────────────────

export interface Stats {
  messagesToday: number;
  unreadConversations: number;
  newLeadsThisWeek: number;
  aiCallsToday: number;
  aiCallCap: number;
  answerMix: { rule: number; faq: number; ai: number; handoff: number; admin: number; other: number };
  answerMixDays: number;
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** จัดกลุ่ม answer_source ให้เป็นภาษาที่คนอ่านเข้าใจ */
export function bucketOfSource(source: string | null): keyof Stats["answerMix"] {
  if (!source) return "other";
  if (source.startsWith("rule:") || source === "menu" || source === "postback:get_started") {
    return "rule";
  }
  if (source === "faq" || source === "postback:faq") return "faq";
  if (source === "kb_ai") return "ai";
  if (source === "handoff") return "handoff";
  if (source === "admin") return "admin";
  return "other";
}

export async function getStats(): Promise<Stats> {
  const page = pageId();
  const mixDays = 7;

  const [msgToday, unread, leadsWeek, aiToday, mixRows] = await Promise.all([
    db()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .gte("created_at", startOfToday()),
    db()
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .eq("unread_for_admin", true),
    db()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .gte("created_at", daysAgo(7)),
    db()
      .from("usage_log")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .gte("created_at", startOfToday()),
    db()
      .from("messages")
      .select("answer_source")
      .eq("page_id", page)
      .eq("direction", "out")
      .gte("created_at", daysAgo(mixDays))
      .limit(5000),
  ]);

  const answerMix = { rule: 0, faq: 0, ai: 0, handoff: 0, admin: 0, other: 0 };
  for (const row of (mixRows.data ?? []) as unknown as { answer_source: string | null }[]) {
    answerMix[bucketOfSource(row.answer_source)] += 1;
  }

  return {
    messagesToday: msgToday.count ?? 0,
    unreadConversations: unread.count ?? 0,
    newLeadsThisWeek: leadsWeek.count ?? 0,
    aiCallsToday: aiToday.count ?? 0,
    aiCallCap: env.brain.dailyAiCallCap(),
    answerMix,
    answerMixDays: mixDays,
  };
}

// ── งานวันนี้ + สถานะบอต ────────────────────────────────────────────────

export interface BotStatus {
  botEnabled: boolean;
  pageRegistered: boolean;
  /** ข้อความล่าสุดที่บอตตอบออกไป */
  lastBotReplyAt: string | null;
  /** ข้อความล่าสุดที่ลูกค้าส่งเข้ามา */
  lastCustomerMessageAt: string | null;
  /** event จาก Facebook ที่ประมวลผลล้มใน 24 ชม. ล่าสุด */
  webhookErrors24h: number;
  messagesToday: number;
  aiCallsToday: number;
  aiCallCap: number;
}

export async function getBotStatus(): Promise<BotStatus> {
  const page = pageId();
  const [fbPage, lastBot, lastIn, errors, msgToday, aiToday] = await Promise.all([
    db().from("fb_pages").select("page_id,bot_enabled").eq("page_id", page).maybeSingle(),
    db()
      .from("messages")
      .select("created_at")
      .eq("page_id", page)
      .eq("sender", "bot")
      .order("created_at", { ascending: false })
      .limit(1),
    db()
      .from("messages")
      .select("created_at")
      .eq("page_id", page)
      .eq("sender", "user")
      .order("created_at", { ascending: false })
      .limit(1),
    db()
      .from("webhook_events")
      .select("event_key", { count: "exact", head: true })
      .eq("status", "error")
      .gte("received_at", daysAgo(1)),
    db()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .gte("created_at", startOfToday()),
    db()
      .from("usage_log")
      .select("id", { count: "exact", head: true })
      .eq("page_id", page)
      .gte("created_at", startOfToday()),
  ]);

  const first = (r: { data: unknown }) =>
    (((r.data ?? []) as { created_at?: string }[])[0]?.created_at ?? null) as string | null;

  return {
    botEnabled: (fbPage.data as { bot_enabled?: boolean } | null)?.bot_enabled ?? true,
    pageRegistered: Boolean(fbPage.data),
    lastBotReplyAt: lastBot.error ? null : first(lastBot),
    lastCustomerMessageAt: lastIn.error ? null : first(lastIn),
    webhookErrors24h: errors.error ? 0 : (errors.count ?? 0),
    messagesToday: msgToday.count ?? 0,
    aiCallsToday: aiToday.count ?? 0,
    aiCallCap: env.brain.dailyAiCallCap(),
  };
}

/** ผู้สนใจที่ยังไม่ได้ติดต่อ — ป้อนให้ "งานวันนี้" */
export async function listNewLeads(limit = 100): Promise<(LeadSummary & { conversation_id: string | null })[]> {
  const run = (cols: string) =>
    db()
      .from("leads")
      .select(`${cols},conversation_id`)
      .eq("page_id", pageId())
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(limit);
  let res = await run(LEAD_COLS_FULL);
  if (res.error) res = await run(LEAD_COLS_LEGACY);
  if (res.error) throw res.error;
  return ((res.data ?? []) as unknown as (Partial<LeadSummary> & { id: string; created_at: string; conversation_id: string | null })[]).map((r) => ({
    ...r,
    name: r.name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    line_id: r.line_id ?? null,
    interest: r.interest ?? null,
    status: r.status ?? "new",
    segment: r.segment ?? null,
    qualification: r.qualification ?? null,
  }));
}
