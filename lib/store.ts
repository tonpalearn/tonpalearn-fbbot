/**
 * ชั้นติดต่อฐานข้อมูล — โค้ดส่วนอื่นไม่ควรเรียก supabase ตรง ๆ
 */
import { db } from "./supabase";
import type { Rule } from "./matching";

export type ConversationState =
  | "bot_active"
  | "collecting_lead"
  | "awaiting_human"
  | "human_active"
  | "closed";

export interface Conversation {
  id: string;
  page_id: string;
  contact_id: string;
  state: ConversationState;
  lead_step: string | null;
  lead_draft: Record<string, unknown>;
  last_user_message_at: string | null;
}

/** ถ้างานเดิมค้างสถานะ processing นานเกินเท่านี้ ถือว่าเครื่องเดิมตายไปแล้ว ให้ลองใหม่ได้ */
const STALE_CLAIM_MS = 2 * 60 * 1000;

/**
 * กันประมวลผล event ซ้ำ — คืน false ถ้าเคยรับ key นี้แล้ว
 * ข้อยกเว้น: ถ้าครั้งก่อนค้างอยู่ที่ processing เกิน 2 นาที (เช่นฟังก์ชันถูกตัดจบกลางทาง)
 * ให้ยอมรับรอบใหม่ ไม่งั้นข้อความนั้นจะหายถาวรทั้งที่ Facebook ยิงซ้ำมาให้แล้ว
 */
export async function claimEvent(eventKey: string): Promise<boolean> {
  const { error } = await db().from("webhook_events").insert({ event_key: eventKey });
  if (!error) return true;
  if (error.code !== "23505") throw error;

  const { data } = await db()
    .from("webhook_events")
    .select("status,received_at")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (!data || data.status !== "processing") return false;

  const age = Date.now() - new Date(data.received_at as string).getTime();
  if (!Number.isFinite(age) || age < STALE_CLAIM_MS) return false;

  await db()
    .from("webhook_events")
    .update({ received_at: new Date().toISOString(), error_note: "รอบก่อนค้าง จึงลองใหม่" })
    .eq("event_key", eventKey);
  return true;
}

export async function markEventDone(eventKey: string, errorNote?: string): Promise<void> {
  await db()
    .from("webhook_events")
    .update({ status: errorNote ? "error" : "done", error_note: errorNote ?? null })
    .eq("event_key", eventKey);
}

export async function upsertContact(params: {
  pageId: string;
  psid: string;
  firstName?: string;
  lastName?: string;
  profilePic?: string;
}): Promise<string> {
  const { data, error } = await db()
    .from("contacts")
    .upsert(
      {
        page_id: params.pageId,
        psid: params.psid,
        first_name: params.firstName ?? null,
        last_name: params.lastName ?? null,
        profile_pic: params.profilePic ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "page_id,psid" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function getOrCreateConversation(
  pageId: string,
  contactId: string,
): Promise<Conversation> {
  const existing = await db()
    .from("conversations")
    .select("id,page_id,contact_id,state,lead_step,lead_draft,last_user_message_at")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as Conversation;

  const created = await db()
    .from("conversations")
    .insert({ page_id: pageId, contact_id: contactId })
    .select("id,page_id,contact_id,state,lead_step,lead_draft,last_user_message_at")
    .single();
  if (created.error) throw created.error;
  return created.data as Conversation;
}

export async function updateConversation(
  id: string,
  patch: Partial<{
    state: ConversationState;
    lead_step: string | null;
    lead_draft: Record<string, unknown>;
    last_user_message_at: string;
    last_bot_message_at: string;
    unread_for_admin: boolean;
  }>,
): Promise<void> {
  const { error } = await db()
    .from("conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function saveMessage(params: {
  conversationId: string;
  pageId: string;
  mid?: string | null;
  direction: "in" | "out";
  sender: "user" | "bot" | "admin" | "system";
  content?: string | null;
  attachments?: unknown;
  answerSource?: string | null;
  confidence?: number | null;
}): Promise<void> {
  const { error } = await db()
    .from("messages")
    .insert({
      conversation_id: params.conversationId,
      page_id: params.pageId,
      mid: params.mid ?? null,
      direction: params.direction,
      sender: params.sender,
      content: params.content ?? null,
      attachments: params.attachments ?? null,
      answer_source: params.answerSource ?? null,
      confidence: params.confidence ?? null,
    });
  // ข้อความซ้ำ (mid เดิม) ไม่ถือเป็นข้อผิดพลาด
  if (error && error.code !== "23505") throw error;
}

export async function getHistory(
  conversationId: string,
  turns: number,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data, error } = await db()
    .from("messages")
    .select("direction,content")
    .eq("conversation_id", conversationId)
    // ข้อความจากระบบ (เช่น สรุปผู้สนใจที่มีเบอร์ลูกค้า) เป็นของแอดมิน ห้ามหลุดเข้าโมเดล
    .neq("sender", "system")
    .not("content", "is", null)
    .order("created_at", { ascending: false })
    .limit(turns);
  if (error) throw error;

  const raw = (data ?? []).reverse().map((m) => ({
    role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant",
    content: String(m.content ?? "").trim(),
  }));

  return normalizeHistory(raw);
}

/**
 * จัดประวัติให้อยู่ในรูปที่โมเดลรับได้ ไม่งั้นจะโดนปฏิเสธทั้งคำขอ
 * (`lib/ai.ts` จะแปลง role `assistant` เป็น `model` ให้ตรงกับที่ Gemini ใช้อีกที)
 *  1. ทิ้งข้อความว่าง (เช่น postback ที่ไม่มีข้อความ)
 *  2. ยุบข้อความฝั่งเดียวกันที่ติดกันให้เป็นก้อนเดียว (บทบาทต้องสลับกัน)
 *  3. ตัดหัวทิ้งจนกว่าตัวแรกจะเป็นฝั่งผู้ใช้
 * เขียนเป็นฟังก์ชันแยกเพื่อให้เขียนเทสต์ได้โดยไม่ต้องแตะฐานข้อมูล
 */
export function normalizeHistory(
  items: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const merged: { role: "user" | "assistant"; content: string }[] = [];

  for (const item of items) {
    const content = item.content.trim();
    if (content === "") continue;
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.content = `${last.content}\n${content}`;
    } else {
      merged.push({ role: item.role, content });
    }
  }

  while (merged.length > 0 && merged[0].role !== "user") merged.shift();
  return merged;
}

/**
 * สวิตช์เปิด/ปิดบอตทั้งเพจ
 * ถ้ายังไม่มีแถวของเพจนี้ในตาราง ให้ถือว่าเปิด — จะได้ไม่ต้องตั้งค่าอะไรก่อนใช้ครั้งแรก
 */
export async function isBotEnabled(pageId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("fb_pages")
    .select("bot_enabled")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error || !data) return true;
  return data.bot_enabled !== false;
}

export async function getActiveRules(pageId: string): Promise<Rule[]> {
  const { data, error } = await db()
    .from("rules")
    .select("id,name,match_type,pattern,action,reply_text,quick_replies,priority")
    .eq("page_id", pageId)
    .eq("is_active", true)
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Rule[];
}

export async function searchFaq(
  pageId: string,
  query: string,
  limit = 3,
): Promise<{ id: string; question: string; answer: string; score: number }[]> {
  const { data, error } = await db().rpc("search_faq", {
    p_page_id: pageId,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as { id: string; question: string; answer: string; score: number }[];
}

export async function searchKb(
  pageId: string,
  query: string,
  limit = 5,
): Promise<{ id: string; title: string; content: string; score: number }[]> {
  const { data, error } = await db().rpc("search_kb", {
    p_page_id: pageId,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as { id: string; title: string; content: string; score: number }[];
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  const v = data.value as { text?: string };
  return typeof v?.text === "string" && v.text.trim() !== "" ? v.text : fallback;
}

export async function saveLead(params: {
  pageId: string;
  conversationId: string;
  contactId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  interest?: string | null;
  leadType: "individual" | "corporate";
  consentAt?: string | null;
  note?: string | null;
  /** ช่องด้านล่างมีเฉพาะหลังรัน migration 0003 — ส่งเฉพาะโฟลว์คัดลูกค้าจากแอด */
  source?: string;
  segment?: string;
  lineId?: string | null;
  qualification?: Record<string, unknown>;
}): Promise<void> {
  const row: Record<string, unknown> = {
    page_id: params.pageId,
    conversation_id: params.conversationId,
    contact_id: params.contactId,
    name: params.name ?? null,
    phone: params.phone ?? null,
    email: params.email ?? null,
    interest: params.interest ?? null,
    lead_type: params.leadType,
    consent_at: params.consentAt ?? null,
  };
  if (params.note !== undefined) row.note = params.note;
  if (params.source !== undefined) row.source = params.source;
  if (params.segment !== undefined) row.segment = params.segment;
  if (params.lineId !== undefined) row.line_id = params.lineId;
  if (params.qualification !== undefined) row.qualification = params.qualification;
  const { error } = await db().from("leads").insert(row);
  if (error) throw error;
}

export async function logHandoff(
  conversationId: string,
  action: "pass" | "take" | "auto_release",
  reason: string,
  actor: "bot" | "admin",
): Promise<void> {
  await db()
    .from("handoff_events")
    .insert({ conversation_id: conversationId, action, reason, actor });
}

export async function logUsage(params: {
  pageId: string;
  conversationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): Promise<void> {
  await db().from("usage_log").insert({
    page_id: params.pageId,
    conversation_id: params.conversationId,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    latency_ms: params.latencyMs,
  });
}

/** เที่ยงคืนของ "วันนี้" ตามเวลาไทย — ไม่ใช่ตามเขตเวลาของเซิร์ฟเวอร์ (Vercel รันเป็น UTC) */
export function startOfThaiDay(now = new Date()): Date {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + bangkokOffsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - bangkokOffsetMs);
}

/**
 * นับจำนวนครั้งที่เรียกโมเดลวันนี้ — ใช้คุมเพดานค่าใช้จ่าย
 * ถ้าอ่านไม่ได้ ให้ถือว่า "เต็มเพดาน" ไว้ก่อน (fail-closed)
 * เพราะเพดานที่หายไปเงียบ ๆ ตอนฐานข้อมูลสะดุด อันตรายกว่าการโยนหาคนเกินจำเป็น
 */
export async function countAiCallsToday(pageId: string): Promise<number> {
  const { count, error } = await db()
    .from("usage_log")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId)
    .gte("created_at", startOfThaiDay().toISOString());
  if (error) return Number.MAX_SAFE_INTEGER;
  return count ?? 0;
}

export async function bumpHit(table: "rules" | "faq_entries", id: string): Promise<void> {
  await db().rpc("increment_hit", { p_table: table, p_id: id }).then(
    () => undefined,
    async () => {
      // ถ้ายังไม่มีฟังก์ชัน increment_hit ก็ข้ามไป ไม่ให้กระทบการตอบลูกค้า
    },
  );
}
