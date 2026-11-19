/**
 * สมองไฮบริดของบอต — ตัดสินใจเป็นชั้น ๆ จากถูกที่สุดไปแพงที่สุด
 *
 *   ชั้น 0  กันข้อความซ้ำ (ทำที่ route ก่อนเรียกไฟล์นี้)
 *   ชั้น 1  บอตถูกปิด / คนกำลังคุยอยู่ → เงียบ
 *   ชั้น 2  คำสั่งพิเศษ: ขอคุยกับคน / ขอเมนู / หยุดบอต
 *   ชั้น 3  กำลังเก็บข้อมูลผู้สนใจอยู่ → เดินขั้นตอนต่อ (โฟลว์คัดลูกค้าจากแอด หรือโฟลว์ชื่อ-เบอร์เดิม)
 *   ชั้น 3b ลูกค้ากดปุ่มยอดขายจากแอด → เริ่มโฟลว์คัดลูกค้า (lib/qualifier.ts)
 *   ชั้น 4  กติกาคำสำคัญที่แอดมินตั้งเอง
 *   ชั้น 5  คำถามที่ถามบ่อย (FAQ) ที่คล้ายพอ
 *   ชั้น 6  ค้นฐานความรู้ + ให้ Claude เรียบเรียง (แพงสุด มีเพดานต่อวัน)
 *   ชั้น 7  ตอบไม่ได้ → เสนอส่งต่อให้คน
 */
import { env } from "./env";
import { answerFromKnowledge } from "./ai";
import { findUnsupportedFacts } from "./guard";
import {
  detectSpecialCommand,
  extractEmail,
  extractPhone,
  isDecline,
  looksCorporate,
  matchRule,
} from "./matching";
import * as store from "./store";
import { getUserProfile } from "./facebook";
import { newChatAlert, notifyOwner } from "./notify";
import type { Conversation } from "./store";
import { VOICE, detectAdEntry, isBotQuestion, isLikelyName, isQualDraft, looksLikeQuestion, type OutPart } from "./qualifier";
import { continueQualifier, finishQualifier, startOpenQualifier, startQualifier } from "./qualifier-flow";

export type BotAction =
  | { kind: "text"; text: string; source: string; confidence?: number }
  /** หลายข้อความติดกัน (แต่ละข้อความมีปุ่มได้) — ตาม BOT-VOICE "ข้อความ 1 / 2 / 3 ส่งแยกกัน" */
  | { kind: "multi"; parts: OutPart[]; source: string }
  | {
      kind: "quick_replies";
      text: string;
      replies: { title: string; payload: string }[];
      source: string;
    }
  /** summary = สรุปให้แอดมิน (บันทึกเป็นข้อความจากระบบในแชท ลูกค้าไม่เห็น) */
  | { kind: "handoff"; text: string; reason: string; summary?: string; pre?: OutPart[] }
  | { kind: "silent"; reason: string };

const MENU_REPLIES = [
  { title: "คอร์สที่เปิดอยู่", payload: "MENU_COURSES" },
  { title: "ราคา/รอบเรียน", payload: "MENU_PRICE" },
  { title: "อบรมในบริษัท", payload: "MENU_CORPORATE" },
  { title: "คุยกับต้น", payload: "MENU_HUMAN" },
];

/** ค่าสำรองเมื่อยังไม่มีแถวใน settings — ข้อความหลักแก้ได้ที่หน้าแอดมิน (BOT-VOICE 2.6) */
const DEFAULT_GREETING = "สวัสดีครับ ผมต้น TONPALEARN\nอยากให้ช่วยเรื่องไหนครับ กดเลือกด้านล่างได้เลย";
const DEFAULT_HANDOFF = "เดี๋ยวผมเข้ามาคุยต่อในแชทนี้ครับ";
const DEFAULT_PERSONA =
  "คุณพิมพ์แชทแทนต้น เจ้าของเพจ TONPALEARN ใช้สรรพนาม \"ผม\" ตอบ 1–3 บรรทัด ถามได้ 1 คำถามต่อข้อความ " +
  "ห้ามขึ้นต้นด้วยคำทักทายหรือคำขอบคุณซ้ำ ห้ามบอกเหตุผลของการถาม ห้ามสัญญาผลลัพธ์หรือเวลา " +
  "ใช้ตัวเลขได้เฉพาะที่อยู่ในเนื้อหาอ้างอิง ถ้าลูกค้าถามว่าคุยกับบอทหรือคน ให้ตอบว่าเป็นระบบตอบอัตโนมัติ";

/** ขั้นตอนเก็บข้อมูลผู้สนใจ ทีละคำถาม ไม่ถามรวดเดียว */
const LEAD_STEPS = ["name", "contact", "interest"] as const;
type LeadStep = (typeof LEAD_STEPS)[number];

const LEAD_QUESTIONS: Record<LeadStep, string> = {
  name: "ขอชื่อก่อนครับ",
  contact: "เบอร์โทร อีเมล หรือ LINE ID ครับ",
  interest: "สนใจแบบไหนครับ เรียนเอง หรือจัดอบรมในบริษัท",
};

export interface IncomingMessage {
  pageId: string;
  psid: string;
  text: string;
  mid?: string | null;
  postbackPayload?: string | null;
}

/**
 * จุดเข้าหลัก: รับข้อความหนึ่งชิ้น → คืนสิ่งที่ควรทำ
 * ฟังก์ชันนี้ *บันทึกข้อความขาเข้าเอง* แต่ไม่ส่งข้อความออก — คนเรียกเป็นคนส่ง
 */
export async function handleIncoming(msg: IncomingMessage): Promise<BotAction> {
  const contactId = await store.upsertContact({ pageId: msg.pageId, psid: msg.psid });
  const convo = await store.getOrCreateConversation(msg.pageId, contactId);

  await store.saveMessage({
    conversationId: convo.id,
    pageId: msg.pageId,
    mid: msg.mid,
    direction: "in",
    sender: "user",
    content: msg.text,
  });
  await store.updateConversation(convo.id, {
    last_user_message_at: new Date().toISOString(),
    unread_for_admin: true,
  });

  // ชื่อ + รูปโปรไฟล์ไว้โชว์ในหน้าแอดมิน · ล้มได้ ห้ามทำให้การตอบล้ม
  let profile: { name: string | null; pic: string | null } = { name: null, pic: null };
  try {
    profile = await store.ensureProfile(contactId, () => getUserProfile(msg.psid));
  } catch (err) {
    console.error(`[brain] ดึงโปรไฟล์ไม่สำเร็จ: ${(err as Error).message}`);
  }
  const history = await store.getHistory(convo.id, 2);
  const firstContact = history.length <= 1;
  if (firstContact) {
    try {
      await notifyOwner(newChatAlert(profile.name, msg.text ?? "", convo.id));
    } catch {
      // แจ้งเตือนล้ม ห้ามทำให้การตอบลูกค้าล้ม
    }
  }

  // ── ชั้น 1: คนกำลังคุยอยู่ บอตต้องเงียบสนิท ──────────────────────────
  if (convo.state === "human_active" || convo.state === "awaiting_human") {
    return { kind: "silent", reason: "คนกำลังดูแลบทสนทนานี้อยู่" };
  }

  // ── ชั้น 1: แอดมินปิดบอตทั้งเพจไว้ ───────────────────────────────────
  if (!(await store.isBotEnabled(msg.pageId))) {
    return { kind: "silent", reason: "บอตถูกปิดไว้ทั้งเพจ" };
  }

  const text = msg.text ?? "";

  // ── ชั้น 2: ปุ่มที่กด (postback) ─────────────────────────────────────
  if (msg.postbackPayload) {
    const fromPostback = await handlePostback(msg.postbackPayload, convo, msg.pageId, contactId);
    if (fromPostback) return fromPostback;
  }

  // ── ชั้น 2: ถามว่าคุยกับบอทหรือคน → ตอบตรงเสมอว่าเป็นระบบตอบอัตโนมัติ แล้วส่งต่อต้น ──
  const inQualifierNow = convo.state === "collecting_lead" && isQualDraft(convo.lead_draft);
  if (isBotQuestion(text) && !inQualifierNow) {
    return { kind: "handoff", text: VOICE.isBot, reason: "ลูกค้าถามว่าคุยกับบอทหรือคน" };
  }

  // ── ชั้น 2: คำสั่งพิเศษ ──────────────────────────────────────────────
  const special = detectSpecialCommand(text);
  const inQualifier = convo.state === "collecting_lead" && isQualDraft(convo.lead_draft);
  if (special === "handoff" || special === "stop_bot") {
    if (inQualifier) {
      // ขอคุยกับคนกลางทาง → เก็บเท่าที่ได้ + สรุปให้คน ไม่ทิ้งข้อมูลที่ถามมาแล้ว
      const notice = await store.getSetting("handoff_notice", DEFAULT_HANDOFF);
      return finishQualifier(
        convo,
        { contactId, psid: msg.psid },
        convo.lead_draft as unknown as Parameters<typeof finishQualifier>[2],
        "ลูกค้าขอคุยกับคน",
        [{ text: notice }],
      );
    }
    return startHandoff(convo.id, "ลูกค้าขอคุยกับคน");
  }
  if (special === "menu") {
    await store.updateConversation(convo.id, { state: "bot_active", lead_step: null, lead_draft: {} });
    return {
      kind: "quick_replies",
      text: await store.getSetting("greeting", DEFAULT_GREETING),
      replies: MENU_REPLIES,
      source: "menu",
    };
  }

  // ── ชั้น 3: กำลังเก็บข้อมูลผู้สนใจ ────────────────────────────────────
  if (inQualifier) {
    return continueQualifier(convo, { contactId, psid: msg.psid }, text);
  }
  if (convo.state === "collecting_lead") {
    return continueLeadCollection(convo, contactId, text);
  }

  // ── ชั้น 3b: ปุ่มยอดขายจากแอด / ขอรายละเอียดงาน → คัดลูกค้าแทนการโยนหาคนทันที ──
  const adEntry = detectAdEntry(text);
  if (adEntry) {
    return startQualifier(convo, adEntry);
  }


  // ── ชั้น 4: กติกาคำสำคัญ ─────────────────────────────────────────────
  const rules = await store.getActiveRules(msg.pageId);
  const hit = matchRule(text, rules);
  if (hit) {
    void store.bumpHit("rules", hit.id);
    if (hit.action === "handoff") return startHandoff(convo.id, `กติกา: ${hit.name}`);
    if (hit.action === "menu") {
      return {
        kind: "quick_replies",
        text: hit.reply_text ?? "กดเลือกได้เลยครับ",
        replies: hit.quick_replies ?? MENU_REPLIES,
        source: `rule:${hit.name}`,
      };
    }
    if (hit.action === "collect_lead") {
      return beginLeadCollection(convo.id, text);
    }
    if (hit.reply_text) {
      return { kind: "text", text: hit.reply_text, source: `rule:${hit.name}`, confidence: 1 };
    }
  }

  // ── ชั้น 4b: คนใหม่ทักเข้ามาเอง (ไม่ได้กดปุ่มแอด) → เข้าโฟลว์คัดลูกค้า (กติกาของต้นมาก่อน · มาก่อน FAQ) ──
  // บทเรียนแชทสด 18 พ.ย. 69: เดิมข้อความพิมพ์เองตกไปโอนหาคนทุกห้อง ลูกค้ารอแล้วเงียบ
  if (convo.state === "bot_active" && text.trim() !== "" && firstContact) {
    return startOpenQualifier(convo, { contactId, psid: msg.psid }, text);
  }

  // ── ชั้น 5: คำถามที่ถามบ่อย ──────────────────────────────────────────
  const threshold = env.brain.similarityThreshold();
  const faqs = await store.searchFaq(msg.pageId, text, 3);
  const bestFaq = faqs[0];
  if (bestFaq && bestFaq.score >= threshold && !bestFaq.answer.startsWith("[กรอกเอง]")) {
    void store.bumpHit("faq_entries", bestFaq.id);
    return {
      kind: "text",
      text: bestFaq.answer,
      source: "faq",
      confidence: Number(bestFaq.score.toFixed(3)),
    };
  }

  // ── ชั้น 6: ค้นฐานความรู้แล้วให้โมเดลเรียบเรียง ───────────────────────
  const usedToday = await store.countAiCallsToday(msg.pageId);
  if (usedToday >= env.brain.dailyAiCallCap()) {
    return startHandoff(convo.id, "ถึงเพดานการใช้โมเดลของวันนี้");
  }

  const chunks = await store.searchKb(msg.pageId, text, env.brain.topK());
  const passages = [
    // เอาคำถามที่ถามบ่อยที่ใกล้เคียงพอมาเป็นเนื้อหาอ้างอิงด้วย
    // (ต้องผ่านเกณฑ์เดียวกัน ไม่งั้นโมเดลจะได้เนื้อหาคนละเรื่องแล้วตอบข้ามเรื่อง)
    ...faqs
      .filter((f) => f.score >= threshold && !f.answer.startsWith("[กรอกเอง]"))
      .map((f) => ({ title: f.question, content: f.answer })),
    // เนื้อหาที่ยังเป็นร่าง (มีคำว่า [กรอกเอง]) ห้ามหลุดเข้าไปให้โมเดลอ่าน
    ...chunks
      .filter((c) => c.score >= threshold && !c.content.includes("[กรอกเอง]"))
      .map((c) => ({ title: c.title, content: c.content })),
  ];

  if (passages.length > 0) {
    const history = await store.getHistory(convo.id, env.brain.historyTurns());
    const persona = await store.getSetting(
      "bot_persona",
      DEFAULT_PERSONA,
    );
    const ai = await answerFromKnowledge({
      question: text,
      passages,
      history: history.slice(0, -1), // ตัดข้อความล่าสุดออก เพราะส่งไปในคำถามแล้ว
      persona,
    });

    if (ai.inputTokens > 0) {
      // ต้อง await — ถ้าปล่อยลอย ฟังก์ชันบน Vercel อาจจบก่อนบันทึกสำเร็จ
      // แล้วเพดานค่าใช้จ่ายจะนับไม่ครบ
      await store.logUsage({
        pageId: msg.pageId,
        conversationId: convo.id,
        model: env.gemini.model(),
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        latencyMs: ai.latencyMs,
      });
    }

    if (ai.text) {
      // ตาข่ายสุดท้าย: ถ้าคำตอบมีราคา/วันที่/เวลา ที่ไม่ปรากฏในเนื้อหาอ้างอิง
      // ถือว่าโมเดลแต่งขึ้นเอง — ห้ามส่งออก ให้โยนหาคนแทน
      const unsupported = findUnsupportedFacts(
        ai.text,
        passages.map((p) => p.content),
      );
      if (unsupported.length > 0) {
        console.error(
          `[brain] คำตอบมีตัวเลขที่ไม่มีในเนื้อหาอ้างอิง (${unsupported.length} จุด) จึงไม่ส่งออก`,
        );
        return startHandoff(convo.id, "คำตอบของโมเดลมีตัวเลขที่ยืนยันไม่ได้");
      }
      return { kind: "text", text: ai.text, source: "kb_ai", confidence: 0.7 };
    }
  }

  // ── ชั้น 7: ตอบไม่ได้ ────────────────────────────────────────────────
  return startHandoff(convo.id, "บอตไม่มีข้อมูลพอจะตอบ");
}

async function handlePostback(
  payload: string,
  convo: Conversation,
  pageId: string,
  _contactId: string,
): Promise<BotAction | null> {
  switch (payload) {
    case "GET_STARTED":
      return {
        kind: "quick_replies",
        text: await store.getSetting("greeting", DEFAULT_GREETING),
        replies: MENU_REPLIES,
        source: "postback:get_started",
      };
    case "MENU_HUMAN":
      return startHandoff(convo.id, "ลูกค้ากดปุ่มขอคุยกับทีมงาน");
    case "MENU_CORPORATE":
      return beginLeadCollection(convo.id, "จัดอบรมในองค์กร");
    case "MENU_COURSES":
    case "MENU_PRICE": {
      const q = payload === "MENU_PRICE" ? "ราคาเท่าไร" : "สอนอะไรบ้าง";
      const faqs = await store.searchFaq(pageId, q, 1);
      const best = faqs[0];
      if (best && !best.answer.startsWith("[กรอกเอง]")) {
        return { kind: "text", text: best.answer, source: "postback:faq", confidence: 1 };
      }
      return startHandoff(convo.id, "ยังไม่ได้กรอกคำตอบของหัวข้อนี้");
    }
    default:
      return null;
  }
}

function nextStep(current: LeadStep | null): LeadStep | null {
  if (current === null) return "name";
  const i = LEAD_STEPS.indexOf(current);
  return i >= 0 && i < LEAD_STEPS.length - 1 ? LEAD_STEPS[i + 1] : null;
}

async function beginLeadCollection(conversationId: string, seedInterest: string): Promise<BotAction> {
  await store.updateConversation(conversationId, {
    state: "collecting_lead",
    lead_step: "name",
    lead_draft: {
      interest_seed: seedInterest,
      lead_type: looksCorporate(seedInterest) ? "corporate" : "individual",
      consent_at: new Date().toISOString(),
    },
  });
  const consent = await store.getSetting(
    "consent_notice",
    "ขอเบอร์โทรหรือ LINE ไว้นัดคุยครับ ถ้ายังไม่อยากให้ก็บอกได้",
  );
  return {
    kind: "text",
    text: `${consent}\n\n${LEAD_QUESTIONS.name}`,
    source: "lead:start",
  };
}

async function continueLeadCollection(
  convo: Conversation,
  contactId: string,
  text: string,
): Promise<BotAction> {
  const draft = { ...(convo.lead_draft ?? {}) } as Record<string, unknown>;
  const step = (convo.lead_step ?? "name") as LeadStep;

  // ลูกค้าไม่สะดวกให้ข้อมูล — หยุดถามทันที ไม่ตื๊อ
  if (isDecline(text)) {
    await store.updateConversation(convo.id, { state: "bot_active", lead_step: null });
    return {
      kind: "text",
      text: "ได้ครับ ไม่เป็นไร อยากถามอะไรพิมพ์มาได้เลย",
      source: "lead:declined",
    };
  }

  if (step === "name") {
    // บั๊กเดิม: คำถามของลูกค้า ("ผมอยากได้แบบวิธีทำเลย") ถูกเก็บเป็นชื่อ แล้วบอตขอเบอร์ต่อ
    if (!isLikelyName(text)) {
      const questions = Array.isArray(draft.questions) ? (draft.questions as string[]) : [];
      if (looksLikeQuestion(text) || text.trim().length > 30) questions.push(text.slice(0, 200));
      draft.questions = questions;
      await store.updateConversation(convo.id, { lead_draft: draft });
      return { kind: "text", text: `ข้อนี้เดี๋ยวผมตอบเองในแชทนี้ครับ\n${LEAD_QUESTIONS.name}`, source: "lead:retry_name" };
    }
    draft.name = text.slice(0, 120);
  } else if (step === "contact") {
    const phone = extractPhone(text);
    const email = extractEmail(text);
    if (!phone && !email) {
      return {
        kind: "text",
        text: "ขอเป็นเบอร์ 10 หลัก หรืออีเมลครับ",
        source: "lead:retry_contact",
      };
    }
    draft.phone = phone;
    draft.email = email;
  } else if (step === "interest") {
    draft.interest = text.slice(0, 500);
  }

  const next = nextStep(step);
  if (next) {
    await store.updateConversation(convo.id, { lead_step: next, lead_draft: draft });
    return { kind: "text", text: LEAD_QUESTIONS[next], source: `lead:${next}` };
  }

  // ครบแล้ว — บันทึกและแจ้งว่าทีมงานจะติดต่อกลับ
  const interest = String(draft.interest ?? draft.interest_seed ?? "");
  await store.saveLead({
    pageId: convo.page_id,
    conversationId: convo.id,
    contactId,
    name: (draft.name as string) ?? null,
    phone: (draft.phone as string) ?? null,
    email: (draft.email as string) ?? null,
    interest: Array.isArray(draft.questions) && draft.questions.length
      ? `${interest} · ถามไว้: ${(draft.questions as string[]).join(" / ")}`
      : interest,
    leadType: looksCorporate(interest) || draft.lead_type === "corporate" ? "corporate" : "individual",
    consentAt: (draft.consent_at as string) ?? new Date().toISOString(),
  });
  await store.updateConversation(convo.id, {
    state: "bot_active",
    lead_step: null,
    lead_draft: {},
    unread_for_admin: true,
  });

  // office_hours: ต้นยังไม่ยืนยันเวลาจริง → ไม่บอกเวลา (BOT-VOICE ข้อ 5 #7)
  return {
    kind: "text",
    text: "ขอบคุณครับ เดี๋ยวผมติดต่อกลับนะครับ",
    source: "lead:done",
  };
}

async function startHandoff(conversationId: string, reason: string): Promise<BotAction> {
  const notice = await store.getSetting("handoff_notice", DEFAULT_HANDOFF);
  return { kind: "handoff", text: notice, reason };
}

/**
 * ลูกค้าส่งรูป/ไฟล์มาโดยไม่มีข้อความ (BOT-VOICE 2.7)
 * ส่งมาเพราะอยากให้ดู (สลิป · ใบกำกับ · ภาพหน้าจอ) → บอกว่าได้รับแล้ว แล้วส่งต่อต้น ไม่โยนงานคืนให้พิมพ์ใหม่
 * ระหว่างคนถือสาย / ปิดบอต → เงียบ แต่ยังบันทึก
 */
export async function handleAttachment(msg: IncomingMessage): Promise<BotAction> {
  const contactId = await store.upsertContact({ pageId: msg.pageId, psid: msg.psid });
  const convo = await store.getOrCreateConversation(msg.pageId, contactId);
  await store.saveMessage({
    conversationId: convo.id,
    pageId: msg.pageId,
    mid: msg.mid,
    direction: "in",
    sender: "user",
    content: "(ส่งไฟล์แนบมา)",
  });
  await store.updateConversation(convo.id, {
    last_user_message_at: new Date().toISOString(),
    unread_for_admin: true,
  });
  if (convo.state === "human_active" || convo.state === "awaiting_human") {
    return { kind: "silent", reason: "คนกำลังดูแลบทสนทนานี้อยู่" };
  }
  if (!(await store.isBotEnabled(msg.pageId))) return { kind: "silent", reason: "บอตถูกปิดไว้ทั้งเพจ" };
  return { kind: "handoff", text: "ได้รับไฟล์แล้วครับ เดี๋ยวผมเปิดดูให้", reason: "ลูกค้าส่งไฟล์/รูปมา" };
}
