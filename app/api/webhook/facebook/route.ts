/**
 * ปลายทางที่ Facebook ยิงเข้ามา
 *
 *   GET  = ยืนยันตัวตนตอนตั้ง webhook ครั้งแรก
 *   POST = รับเหตุการณ์จริง (ข้อความ, ปุ่มที่กด, การส่งคืนสาย)
 *
 * กติกาสำคัญ: ต้องตอบ 200 ให้ Facebook ให้ไวที่สุด ไม่งั้นมันจะยิงซ้ำ
 * → งานหนักทั้งหมดทำใน after() ซึ่งรันหลังส่ง response แล้ว
 */
import { after } from "next/server";
import { env } from "@/lib/env";
import { verifySignature, sendText, sendQuickReplies, sendSenderAction, passThreadControl } from "@/lib/facebook";
import { handleAttachment, handleIncoming, type BotAction } from "@/lib/brain";
import type { OutPart } from "@/lib/qualifier";
import * as store from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// เส้นทางเต็มมีทั้งคิวรีฐานข้อมูล เรียก Facebook และเรียกโมเดล — เผื่อเวลาไว้ให้พอ
export const maxDuration = 60;

// ── ยืนยัน webhook ────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.fb.verifyToken() && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("ยืนยันไม่ผ่าน", { status: 403 });
}

// ── รับเหตุการณ์ ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  // ต้องอ่าน raw body เพื่อตรวจลายเซ็น — อ่านซ้ำไม่ได้ จึง parse จากสตริงนี้เอง
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("ลายเซ็นไม่ถูกต้อง", { status: 401 });
  }

  let body: FacebookWebhookBody;
  try {
    body = JSON.parse(raw) as FacebookWebhookBody;
  } catch {
    return new Response("EVENT_RECEIVED", { status: 200 }); // ตอบ 200 ไว้ก่อน ไม่ให้ Facebook ยิงซ้ำ
  }

  if (body.object !== "page") return new Response("EVENT_RECEIVED", { status: 200 });

  // ประมวลผลหลังตอบกลับแล้ว
  after(async () => {
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        try {
          await processEvent(entry.id, event);
        } catch (err) {
          // log เฉพาะสาเหตุ ไม่ log ตัวข้อความของลูกค้า
          console.error("[webhook] ประมวลผลไม่สำเร็จ:", (err as Error).message);
        }
      }

      // ระหว่างที่คนถือสายอยู่ Facebook จะส่งข้อความของลูกค้ามาทาง standby แทน messaging
      // ต้องบันทึกไว้ให้แอดมินเห็น ไม่งั้นข้อความช่วงสำคัญที่สุดจะหายเงียบ ๆ
      for (const event of entry.standby ?? []) {
        try {
          await recordStandbyEvent(entry.id, event);
        } catch (err) {
          console.error("[webhook] บันทึกข้อความช่วงคนถือสายไม่สำเร็จ:", (err as Error).message);
        }
      }
    }
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processEvent(pageId: string, event: MessagingEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) return;

  // เสียงสะท้อนจากข้อความที่เพจส่งเอง — บันทึกไว้เฉย ๆ ไม่ต้องตอบ
  if (event.message?.is_echo) return;

  // Facebook คืนสายกลับมาให้บอต
  if (event.pass_thread_control) {
    await handleThreadReturned(pageId, psid);
    return;
  }
  if (event.take_thread_control) return; // มีคนดึงสายไป บอตเงียบไว้

  const mid = event.message?.mid ?? null;
  const eventKey = mid ?? `${psid}:${event.timestamp ?? Date.now()}:${event.postback?.payload ?? ""}`;

  // ชั้น 0 — กันประมวลผลซ้ำ
  const isNew = await store.claimEvent(eventKey);
  if (!isNew) return;

  try {
    const text = event.message?.text ?? event.postback?.title ?? "";
    const postbackPayload =
      event.postback?.payload ?? event.message?.quick_reply?.payload ?? null;

    // ลูกค้าส่งรูป/สติกเกอร์/ไฟล์ มาโดยไม่มีข้อความ → บอกว่าได้รับแล้ว + ส่งต่อต้น (BOT-VOICE 2.7)
    if (!text && !postbackPayload) {
      if (event.message?.attachments?.length) {
        const action = await handleAttachment({ pageId, psid, text: "", mid });
        await deliver(pageId, psid, action);
      }
      await store.markEventDone(eventKey);
      return;
    }

    // "อ่านแล้ว/กำลังพิมพ์" เป็นแค่ลูกเล่น ห้ามมีอำนาจทำให้คำตอบไม่ถูกส่ง
    await sendSenderAction(psid, "mark_seen").catch(() => {});
    await sendSenderAction(psid, "typing_on").catch(() => {});

    const action = await handleIncoming({ pageId, psid, text, mid, postbackPayload });
    await deliver(pageId, psid, action);
    await store.markEventDone(eventKey);
  } catch (err) {
    await store.markEventDone(eventKey, (err as Error).message);
    throw err;
  }
}

/** ส่งข้อความหนึ่งชิ้น (มีปุ่มหรือไม่มี) แล้วบันทึก */
async function sendPart(
  pageId: string,
  psid: string,
  conversationId: string,
  part: OutPart,
  source: string,
): Promise<void> {
  if (part.replies?.length) await sendQuickReplies(psid, part.text, part.replies);
  else await sendText(psid, part.text);
  await store.saveMessage({
    conversationId,
    pageId,
    direction: "out",
    sender: "bot",
    content: part.text,
    answerSource: source,
  });
}

/** ส่งผลลัพธ์ที่สมองตัดสินใจแล้วกลับไปหาลูกค้า + บันทึกลงฐานข้อมูล */
async function deliver(pageId: string, psid: string, action: BotAction): Promise<void> {
  const contactId = await store.upsertContact({ pageId, psid });
  const convo = await store.getOrCreateConversation(pageId, contactId);

  if (action.kind === "silent") return;

  if (action.kind === "multi") {
    for (const part of action.parts) await sendPart(pageId, psid, convo.id, part, action.source);
    await store.updateConversation(convo.id, { last_bot_message_at: new Date().toISOString() });
    return;
  }

  if (action.kind === "handoff") {
    // ลำดับสำคัญ: ตั้งสถานะให้บอตเงียบ "ก่อน" เรียก Facebook
    // ถ้าโอนสายไม่สำเร็จ (เช่น ยังไม่ได้ตั้งเพจให้แอปนี้เป็นผู้รับหลัก)
    // อย่างน้อยบอตต้องหยุดพูดประโยคเดิมซ้ำ ๆ และแอดมินต้องเห็นว่ามีคนรออยู่
    await store.updateConversation(convo.id, { state: "awaiting_human", unread_for_admin: true });
    await store.logHandoff(convo.id, "pass", action.reason, "bot");
    // ข้อความที่ต้องส่งก่อนข้อความโอนสาย (เช่น เคส + ลิงก์ portfolio)
    for (const part of action.pre ?? []) {
      await sendPart(pageId, psid, convo.id, part, "handoff_pre").catch((err) =>
        console.error(`[webhook] ส่งข้อความก่อนโอนสายไม่สำเร็จ: ${(err as Error).message}`),
      );
    }
    await store.saveMessage({
      conversationId: convo.id,
      pageId,
      direction: "out",
      sender: "bot",
      content: action.text,
      answerSource: "handoff",
    });
    if (action.summary) {
      // สรุปจากโฟลว์คัดลูกค้า — ให้แอดมินเห็นในหน้าแชททันที (ไม่ส่งหาลูกค้า)
      await store.saveMessage({
        conversationId: convo.id,
        pageId,
        direction: "out",
        sender: "system",
        content: action.summary,
        answerSource: "lead_summary",
      });
    }

    await sendText(psid, action.text);

    try {
      await passThreadControl(psid, action.reason);
    } catch (err) {
      // โอนไม่สำเร็จ = แชทไม่โผล่ใน Meta Business Suite แต่ยังอยู่ในหน้าแอดมินของเรา
      console.error(`[webhook] โอนสายไม่สำเร็จ: ${(err as Error).message}`);
      await store.saveMessage({
        conversationId: convo.id,
        pageId,
        direction: "out",
        sender: "system",
        content:
          "โอนสายให้ Page Inbox ไม่สำเร็จ — แชทนี้จะไม่ขึ้นใน Meta Business Suite " +
          "ให้ตอบจากหน้าแอดมินนี้แทน (ตรวจการตั้งค่าผู้รับหลักในเพจ ตาม docs/DEPLOY.md ขั้นที่ 4)",
        answerSource: "system",
      });
    }
    return;
  }

  if (action.kind === "quick_replies") {
    await sendQuickReplies(psid, action.text, action.replies);
  } else {
    await sendText(psid, action.text);
  }

  await store.saveMessage({
    conversationId: convo.id,
    pageId,
    direction: "out",
    sender: "bot",
    content: action.text,
    answerSource: action.source,
    confidence: "confidence" in action ? (action.confidence ?? null) : null,
  });
  await store.updateConversation(convo.id, { last_bot_message_at: new Date().toISOString() });
}

/**
 * ข้อความที่เข้ามาระหว่างที่ "คน" ถือสายอยู่ (standby channel)
 * บอตต้องเงียบสนิท แต่ต้องบันทึกไว้และตั้งธงให้แอดมินเห็น — ห้ามปล่อยหาย
 */
async function recordStandbyEvent(pageId: string, event: MessagingEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid || event.message?.is_echo) return;

  const text = event.message?.text ?? "";
  const hasAttachment = Boolean(event.message?.attachments?.length);
  if (!text && !hasAttachment) return;

  const mid = event.message?.mid ?? null;
  const eventKey = mid ? `standby:${mid}` : `standby:${psid}:${event.timestamp ?? Date.now()}`;
  if (!(await store.claimEvent(eventKey))) return;

  const contactId = await store.upsertContact({ pageId, psid });
  const convo = await store.getOrCreateConversation(pageId, contactId);

  await store.saveMessage({
    conversationId: convo.id,
    pageId,
    mid,
    direction: "in",
    sender: "user",
    content: text || "(ส่งไฟล์แนบมา)",
    attachments: event.message?.attachments ?? null,
  });
  await store.updateConversation(convo.id, {
    last_user_message_at: new Date().toISOString(),
    unread_for_admin: true,
  });
  await store.markEventDone(eventKey);
}

/** แอดมินคืนสายกลับมาแล้ว — ให้บอตกลับมาทำงาน */
async function handleThreadReturned(pageId: string, psid: string): Promise<void> {
  const contactId = await store.upsertContact({ pageId, psid });
  const convo = await store.getOrCreateConversation(pageId, contactId);
  await store.updateConversation(convo.id, { state: "bot_active" });
  await store.logHandoff(convo.id, "auto_release", "Facebook คืนสายกลับมาให้บอต", "admin");
}

// ── รูปร่างข้อมูลที่ Facebook ส่งมา (เท่าที่เราใช้) ──────────────────────
interface FacebookWebhookBody {
  object?: string;
  entry?: { id: string; messaging?: MessagingEvent[]; standby?: MessagingEvent[] }[];
}

interface MessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload: string };
    attachments?: { type: string; payload?: unknown }[];
  };
  postback?: { title?: string; payload?: string };
  pass_thread_control?: { new_owner_app_id?: string; metadata?: string };
  take_thread_control?: { previous_owner_app_id?: string; metadata?: string };
}
