/**
 * ตามต่ออัตโนมัติ 1 ข้อความ (BOT-VOICE ข้อ 3.6) — รันจาก Vercel Cron ผ่าน /api/cron/followup
 *
 * กติกา (บังคับด้วยโค้ด):
 *  - เฉพาะห้องที่ยังอยู่ในโฟลว์คัดลูกค้าจากแอด (collecting_lead + flow=qualifier) และบอตพูดเป็นคนสุดท้าย
 *  - ลูกค้าเงียบครบ FOLLOWUP_AFTER_HOURS (ค่าเริ่ม 4 ชม.)
 *  - **ต้องยังอยู่ในกรอบ 24 ชม. ของ Meta** นับจากข้อความล่าสุดของลูกค้า (เผื่อขอบ 30 นาที → ส่งได้ถึง 23:30 ชม.)
 *  - งดส่ง 21:00–08:30 เวลาไทย (รอบ cron ถัดไปค่อยส่ง ถ้ายังอยู่ในกรอบ)
 *  - ส่งครั้งเดียวต่อห้อง (จองสิทธิ์ด้วย update ... where followup_sent_at is null ก่อนส่ง)
 *  - ห้ามส่งถ้าคนเข้ามาคุยแล้ว: สถานะ human_active / awaiting_human หรือมีข้อความจากแอดมินหลังลูกค้าพิมพ์ล่าสุด
 *  - ร่างตามรอบ 2 (วันที่ 3–5) **ไม่ส่งเอง** แค่บันทึกไว้ให้ต้นคัดลอก
 */
import { db } from "./supabase";
import * as store from "./store";
import { sendQuickReplies, sendText } from "./facebook";
import {
  CASES,
  FREE_CALL_LINE,
  FREE_FIRST_CALL,
  TASK_BUTTONS,
  TASK_BUTTONS_SMALL,
  THINK_BUTTONS,
  isQualDraft,
  pickCase,
  roundTwoDraft,
  slotButtons,
  usableSlots,
  type OutPart,
  type QualDraft,
} from "./qualifier";

const HOUR = 3600_000;
export const WINDOW_MS = 24 * HOUR;
/** ขอบเผื่อก่อนหมดกรอบ 24 ชม. (นาฬิกาเครื่อง/รอบ cron คลาดได้) */
export const WINDOW_SAFETY_MS = 30 * 60_000;

export function followupAfterMs(): number {
  const h = Number(process.env.FOLLOWUP_AFTER_HOURS ?? "4");
  return (Number.isFinite(h) && h > 0 ? h : 4) * HOUR;
}

/** เวลาไทยตอนนี้อยู่ในช่วงห้ามส่ง 21:00–08:30 ไหม */
export function inQuietHours(now: Date): boolean {
  const bkk = new Date(now.getTime() + 7 * HOUR);
  const minutes = bkk.getUTCHours() * 60 + bkk.getUTCMinutes();
  return minutes >= 21 * 60 || minutes < 8 * 60 + 30;
}

export type FollowupVariant = "ka_first" | "kho_case" | "kho2_offer" | "kho3_seen_case" | "kha_price" | "ngo_self";

/** เลือกข้อความตามสิ่งที่ได้จากลูกค้าแล้ว (BOT-VOICE 3.6 ก–ง) */
export function pickFollowup(
  d: QualDraft,
  slots: string[],
): { variant: FollowupVariant; parts: OutPart[]; patch?: Partial<QualDraft> } {
  if (d.segment === "self_learn") {
    return {
      variant: "ngo_self",
      parts: [{ text: "ถ้าอยากรู้ว่าคอร์สนี้เหมาะกับงานคุณไหม พิมพ์งานที่อยากทำมาได้เลยครับ ผมตอบเอง" }],
    };
  }
  if (d.priceShown) {
    return {
      variant: "kha_price",
      parts: [
        {
          text: "ถ้าอยากเริ่มเล็กกว่านี้ ครึ่งวันเรื่องเดียวที่เจ็บที่สุดก็ได้ครับ\nติดเรื่องงบ เวลา หรือยังไม่แน่ใจว่า AI ช่วยได้จริงครับ",
          replies: THINK_BUTTONS,
        },
      ],
      // ปุ่มเรื่องงบ/เวลา/ไม่แน่ใจ → คำตอบไปเข้าช่อง think_reason (ส่งต่อต้นพร้อมเหตุผล)
      patch: { pending: "think_reason" },
    };
  }
  if (d.meetingOffered) {
    return {
      variant: "kho2_offer",
      parts: [{ text: "ทักอีกทีครับ ถ้าสองเวลานั้นไม่สะดวก บอกวันที่สะดวกมาได้เลย หรือถ้ายังไม่ใช่ตอนนี้ก็บอกได้ครับ" }],
    };
  }
  if (d.caseShown) {
    const free = FREE_FIRST_CALL ? `${FREE_CALL_LINE}\n` : "";
    const head = "ถ้าคุยกัน 30 นาที ผมบอกได้ว่าควรเริ่มตรงไหน ถ้าไม่เหมาะผมบอกตรง ๆ";
    return slots.length === 2
      ? {
          variant: "kho3_seen_case",
          parts: [{ text: `${head}\n${free}สะดวก ${slots[0]} หรือ ${slots[1]} ครับ`, replies: slotButtons(slots) }],
          patch: { pending: "slot", meetingOffered: true, offeredSlots: slots },
        }
      : { variant: "kho3_seen_case", parts: [{ text: `${head}\n${free}ถ้าสะดวกคุย พิมพ์ว่า คุย ได้เลยครับ` }] };
  }
  if (d.fields.pain || d.fields.task) {
    const key = d.fields.business_type ? pickCase(d.fields.business_type).key : "agent";
    return {
      variant: "kho_case",
      parts: [
        {
          text:
            `งานที่เล่าไว้ ผมนึกถึงเคส${CASES[key].label}ที่คล้ายกันครับ\n` +
            "ถ้าสนใจผมเล่าให้ฟังสั้น ๆ ได้ พิมพ์ว่า เล่าเลย ได้ครับ",
        },
      ],
    };
  }
  return {
    variant: "ka_first",
    parts: [
      {
        text: "ยังไม่ต้องพิมพ์ยาวครับ กดเลือกงานที่อยากให้ AI ช่วยด้านล่างได้เลย",
        replies: d.segment === "small" ? TASK_BUTTONS_SMALL : TASK_BUTTONS,
      },
    ],
  };
}

export interface FollowupCandidate {
  id: string;
  page_id: string;
  contact_id: string;
  state: string;
  lead_draft: Record<string, unknown>;
  last_user_message_at: string | null;
  last_bot_message_at: string | null;
  followup_sent_at: string | null;
}

/** ตัดสินว่าห้องนี้ส่งได้ไหม — ฟังก์ชันบริสุทธิ์ เขียนเทสต์ได้ทุกกิ่ง */
export function eligibility(c: FollowupCandidate, now: Date, adminRepliedSinceUser: boolean): { ok: boolean; why: string } {
  if (c.followup_sent_at) return { ok: false, why: "ส่งไปแล้ว" };
  if (c.state !== "collecting_lead" || !isQualDraft(c.lead_draft)) return { ok: false, why: `สถานะ ${c.state}` };
  if (adminRepliedSinceUser) return { ok: false, why: "คนตอบแล้ว" };
  if (!c.last_user_message_at) return { ok: false, why: "ไม่มีข้อความลูกค้า" };
  const lastUser = new Date(c.last_user_message_at).getTime();
  const lastBot = c.last_bot_message_at ? new Date(c.last_bot_message_at).getTime() : 0;
  if (lastBot < lastUser) return { ok: false, why: "บอตยังไม่ได้ตอบข้อความล่าสุด" };
  const silent = now.getTime() - lastUser;
  if (silent < followupAfterMs()) return { ok: false, why: "ยังเงียบไม่ครบ" };
  if (silent >= WINDOW_MS - WINDOW_SAFETY_MS) return { ok: false, why: "เลยกรอบ 24 ชม. ของ Meta" };
  if (inQuietHours(now)) return { ok: false, why: "ช่วงห้ามส่ง 21:00–08:30" };
  return { ok: true, why: "ส่งได้" };
}

export interface FollowupReport {
  checked: number;
  sent: { conversationId: string; variant: FollowupVariant }[];
  skipped: { conversationId: string; why: string }[];
  failed: { conversationId: string; error: string }[];
}

export async function runFollowups(now = new Date()): Promise<FollowupReport> {
  const report: FollowupReport = { checked: 0, sent: [], skipped: [], failed: [] };
  const from = new Date(now.getTime() - WINDOW_MS).toISOString();

  const { data, error } = await db()
    .from("conversations")
    .select("id,page_id,contact_id,state,lead_draft,last_user_message_at,last_bot_message_at,followup_sent_at")
    .eq("state", "collecting_lead")
    .is("followup_sent_at", null)
    .gte("last_user_message_at", from)
    .limit(200);
  if (error) throw error;

  const slots = usableSlots(await store.getSetting("meeting_slots", ""), now);

  for (const c of (data ?? []) as FollowupCandidate[]) {
    report.checked++;
    const adminMsgs = await db()
      .from("messages")
      .select("id")
      .eq("conversation_id", c.id)
      .eq("sender", "admin")
      .gte("created_at", c.last_user_message_at ?? from)
      .limit(1);
    const e = eligibility(c, now, (adminMsgs.data ?? []).length > 0);
    if (!e.ok) {
      report.skipped.push({ conversationId: c.id, why: e.why });
      continue;
    }

    // จองสิทธิ์ก่อนส่ง — กันส่งซ้ำเมื่อ cron ซ้อนกัน (ส่งล้มก็ไม่ลองใหม่ = ไม่เกิน 1 ข้อความ)
    const claim = await db()
      .from("conversations")
      .update({ followup_sent_at: now.toISOString() })
      .eq("id", c.id)
      .is("followup_sent_at", null)
      .select("id");
    if (claim.error || (claim.data ?? []).length !== 1) {
      report.skipped.push({ conversationId: c.id, why: "มีรอบอื่นจองไปแล้ว" });
      continue;
    }

    const d = c.lead_draft as unknown as QualDraft;
    const f = pickFollowup(d, slots);
    try {
      const contact = await db().from("contacts").select("psid").eq("id", c.contact_id).maybeSingle();
      const psid = (contact.data as { psid?: string } | null)?.psid;
      if (!psid) throw new Error("ไม่พบ psid");
      for (const part of f.parts) {
        if (part.replies?.length) await sendQuickReplies(psid, part.text, part.replies);
        else await sendText(psid, part.text);
        await store.saveMessage({
          conversationId: c.id,
          pageId: c.page_id,
          direction: "out",
          sender: "bot",
          content: part.text,
          answerSource: `followup:${f.variant}`,
        });
      }
      await store.updateConversation(c.id, {
        ...(f.patch ? { lead_draft: { ...c.lead_draft, ...f.patch } } : {}),
        followup_variant: f.variant,
        last_bot_message_at: now.toISOString(),
        // ร่างตามรอบ 2 ให้ต้นคัดลอกไปส่งเองวันที่ 3–5 (บอตไม่ส่ง)
        followup_draft: roundTwoDraft(d),
        followup_draft_at: now.toISOString(),
      });
      report.sent.push({ conversationId: c.id, variant: f.variant });
    } catch (err) {
      console.error(`[followup] ส่งไม่สำเร็จ: ${(err as Error).message}`);
      report.failed.push({ conversationId: c.id, error: (err as Error).message });
    }
  }
  return report;
}
