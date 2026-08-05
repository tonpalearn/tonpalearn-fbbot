/**
 * สมองไฮบริดของบอต — ตัดสินใจเป็นชั้น ๆ จากถูกที่สุดไปแพงที่สุด
 *
 *   ชั้น 0  กันข้อความซ้ำ (ทำที่ route ก่อนเรียกไฟล์นี้)
 *   ชั้น 1  บอตถูกปิด / คนกำลังคุยอยู่ → เงียบ
 *   ชั้น 2  คำสั่งพิเศษ: ขอคุยกับคน / ขอเมนู / หยุดบอต
 *   ชั้น 3  กำลังเก็บข้อมูลผู้สนใจอยู่ → เดินขั้นตอนต่อ
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
import type { Conversation } from "./store";

export type BotAction =
  | { kind: "text"; text: string; source: string; confidence?: number }
  | {
      kind: "quick_replies";
      text: string;
      replies: { title: string; payload: string }[];
      source: string;
    }
  | { kind: "handoff"; text: string; reason: string }
  | { kind: "silent"; reason: string };

const MENU_REPLIES = [
  { title: "คอร์สที่เปิดอยู่", payload: "MENU_COURSES" },
  { title: "ราคา/รอบอบรม", payload: "MENU_PRICE" },
  { title: "จัดอบรมในองค์กร", payload: "MENU_CORPORATE" },
  { title: "คุยกับทีมงาน", payload: "MENU_HUMAN" },
];

/** ขั้นตอนเก็บข้อมูลผู้สนใจ ทีละคำถาม ไม่ถามรวดเดียว */
const LEAD_STEPS = ["name", "contact", "interest"] as const;
type LeadStep = (typeof LEAD_STEPS)[number];

const LEAD_QUESTIONS: Record<LeadStep, string> = {
  name: "ขอทราบชื่อที่ให้ทีมงานเรียกหน่อยครับ",
  contact: "ขอเบอร์โทรหรืออีเมลสำหรับติดต่อกลับครับ",
  interest: "สนใจเรื่องไหนเป็นพิเศษครับ (เช่น คอร์สไหน หรือ อยากจัดอบรมในองค์กร)",
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

  // ── ชั้น 2: คำสั่งพิเศษ ──────────────────────────────────────────────
  const special = detectSpecialCommand(text);
  if (special === "handoff" || special === "stop_bot") {
    return startHandoff(convo.id, "ลูกค้าขอคุยกับคน");
  }
  if (special === "menu") {
    await store.updateConversation(convo.id, { state: "bot_active", lead_step: null });
    return {
      kind: "quick_replies",
      text: await store.getSetting("greeting", "อยากให้ช่วยเรื่องไหนดีครับ"),
      replies: MENU_REPLIES,
      source: "menu",
    };
  }

  // ── ชั้น 3: กำลังเก็บข้อมูลผู้สนใจ ────────────────────────────────────
  if (convo.state === "collecting_lead") {
    return continueLeadCollection(convo, contactId, text);
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
        text: hit.reply_text ?? "เลือกหัวข้อที่สนใจได้เลยครับ",
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
      "คุณคือผู้ช่วยตอบแชทของเพจ พูดสุภาพ กระชับ ลงท้ายว่า ครับ",
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
        model: env.anthropic.model(),
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
        text: await store.getSetting("greeting", "สวัสดีครับ อยากให้ช่วยเรื่องไหนดีครับ"),
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
    "ขออนุญาตเก็บชื่อและช่องทางติดต่อไว้ให้ทีมงานติดต่อกลับเท่านั้นนะครับ",
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
      text: "ได้ครับ ไม่เก็บข้อมูลนะครับ ถ้าอยากถามอะไรเพิ่มพิมพ์มาได้เลยครับ",
      source: "lead:declined",
    };
  }

  if (step === "name") {
    draft.name = text.slice(0, 120);
  } else if (step === "contact") {
    const phone = extractPhone(text);
    const email = extractEmail(text);
    if (!phone && !email) {
      return {
        kind: "text",
        text: "ขอเป็นเบอร์โทร 10 หลัก หรืออีเมลก็ได้ครับ",
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
    interest,
    leadType: looksCorporate(interest) || draft.lead_type === "corporate" ? "corporate" : "individual",
    consentAt: (draft.consent_at as string) ?? new Date().toISOString(),
  });
  await store.updateConversation(convo.id, {
    state: "bot_active",
    lead_step: null,
    lead_draft: {},
    unread_for_admin: true,
  });

  const hours = await store.getSetting("office_hours", "");
  return {
    kind: "text",
    text: `รับข้อมูลเรียบร้อยครับ เดี๋ยวทีมงานติดต่อกลับนะครับ 🙏${hours ? `\n${hours}` : ""}`,
    source: "lead:done",
  };
}

async function startHandoff(conversationId: string, reason: string): Promise<BotAction> {
  const notice = await store.getSetting(
    "handoff_notice",
    "กำลังเรียกทีมงานมาคุยต่อให้ครับ สักครู่นะครับ",
  );
  return { kind: "handoff", text: notice, reason };
}
