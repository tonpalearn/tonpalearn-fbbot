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
  lastMessage: string;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
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
      "id,state,unread_for_admin,last_user_message_at,updated_at,contact:contacts(first_name,last_name,psid)",
    )
    .eq("page_id", pageId())
    .order("updated_at", { ascending: false })
    .limit(opts.limit);

  if (opts.state) q = q.eq("state", opts.state);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawConversation[];
  const last = await lastMessages(rows.map((r) => r.id));

  return rows.map((r) => {
    const lm = last.get(r.id);
    return {
      id: r.id,
      state: r.state,
      unread: r.unread_for_admin,
      lastUserMessageAt: r.last_user_message_at,
      updatedAt: r.updated_at,
      name: displayName(pickContact(r.contact)),
      lastMessage: lm?.content ?? "",
      lastMessageSender: lm?.sender ?? null,
      lastMessageAt: lm?.created_at ?? null,
    };
  });
}

export interface ConversationDetail {
  id: string;
  state: ConversationState;
  name: string;
  psid: string;
  lastUserMessageAt: string | null;
  messages: MessageRow[];
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

  const msgs = await db()
    .from("messages")
    .select("id,direction,sender,content,answer_source,confidence,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (msgs.error) throw msgs.error;

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
    psid: contact?.psid ?? "",
    lastUserMessageAt: row.last_user_message_at,
    messages,
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
