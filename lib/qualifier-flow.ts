/**
 * ตัวเดินโฟลว์คัดลูกค้าจากแอด — ส่วนที่แตะฐานข้อมูล/โมเดล/LINE
 * ตรรกะล้วน ๆ (ถ้อยคำ ลำดับคำถาม การจับคำ) อยู่ใน lib/qualifier.ts
 */
import { env } from "./env";
import { extractQualifierFields } from "./ai";
import { notifyOwner } from "./notify";
import * as store from "./store";
import type { Conversation } from "./store";
import type { BotAction } from "./brain";
import {
  EXTRA,
  SCRIPT,
  buildSummary,
  contactToString,
  deterministicExtract,
  detectInterjection,
  extractContact,
  fieldOrder,
  looksLikeQuestion,
  newDraft,
  nextField,
  openingMessage,
  questionFor,
  sanitizeExtracted,
  selfLearnPrice,
  selfLearnRecommendation,
  type AdEntry,
  type ContactInfo,
  type QField,
  type QualDraft,
} from "./qualifier";

type Draft = QualDraft & { contactInfo?: ContactInfo };

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

async function save(convoId: string, d: Draft): Promise<void> {
  await store.updateConversation(convoId, {
    state: "collecting_lead",
    lead_step: d.pending ? `q:${d.pending}` : null,
    lead_draft: d as unknown as Record<string, unknown>,
  });
}

function reply(text: string, source: string): BotAction {
  return { kind: "text", text, source };
}

/** ลูกค้ากดปุ่มยอดขาย (หรือพิมพ์แนวเดียวกัน) → ตอบด่าน 1 ตามปุ่ม */
export async function startQualifier(convo: Conversation, entry: AdEntry): Promise<BotAction> {
  const open = openingMessage(entry);
  const d: Draft = newDraft(entry, open.pending);
  await save(convo.id, d);
  return reply(open.text, `qualifier:open:${entry.segment}`);
}

/** ถามช่องถัดไป หรือปิดงานถ้าครบแล้ว */
async function askNext(
  convo: Conversation,
  contactId: string,
  d: Draft,
  lead = "",
): Promise<BotAction> {
  const next = nextField(d);
  if (!next) {
    const done = d.segment === "self_learn" ? EXTRA.doneSelf : EXTRA.doneConsult;
    return finishQualifier(convo, contactId, d, "ได้ข้อมูลครบ", lead ? `${lead}\n\n${done}` : done);
  }
  const q = questionFor(next, d);
  d.pending = next;
  d.retries = 0;
  d.consentShown = q.consentShown;
  await save(convo.id, d);
  return reply(lead ? `${lead}\n\n${q.text}` : q.text, `qualifier:ask:${next}`);
}

/** ถามช่องเดิมซ้ำ (หลังตอบแทรก/นอกเรื่อง) */
async function reAsk(convo: Conversation, d: Draft, lead: string, source: string): Promise<BotAction> {
  const field = d.pending ?? nextField(d);
  if (!field) return reply(lead, source);
  const q = questionFor(field, d);
  d.pending = field;
  d.consentShown = q.consentShown;
  await save(convo.id, d);
  return reply(`${lead}\n\n${q.text}`, source);
}

async function canUseModel(pageId: string): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  const used = await store.countAiCallsToday(pageId);
  return used < env.brain.dailyAiCallCap();
}

/**
 * สกัดค่าจากคำตอบ: ใช้กติกาตายตัวก่อน แล้วให้โมเดลช่วยแยกช่อง (ถ้าใช้ได้)
 * โมเดลล้ม/ถึงเพดาน = ใช้ผลกติกาตายตัวอย่างเดียว ไม่ทำให้บทสนทนาสะดุด
 */
async function extract(
  convo: Conversation,
  d: Draft,
  text: string,
): Promise<{ fields: Partial<Record<QField, string>>; intent: "answer" | "off_topic" | "question" }> {
  const det = deterministicExtract(text, d.pending);
  // โมเดล/กติกาบอกว่าไม่ได้ตอบ → ทิ้งค่าที่กติกาตายตัวยัดใส่ช่องไว้ (เก็บแค่ตัวเลขขนาดทีมที่จับได้จริง)
  const notAnswer = (intent: "off_topic" | "question") => {
    const keep: Partial<Record<QField, string>> = det.team_size ? { team_size: det.team_size } : {};
    return { fields: keep, intent: Object.keys(keep).length ? ("answer" as const) : intent };
  };

  // ช่องชื่อใช้กติกาตายตัวพอ ไม่ต้องเสียค่าโมเดล
  if (d.pending === "name" || !(await canUseModel(convo.page_id))) {
    return looksLikeQuestion(text) ? notAnswer("question") : { fields: det, intent: "answer" };
  }

  try {
    const asked = d.pending ? questionFor(d.pending, { ...d, consentShown: true }).text : "";
    const ai = await extractQualifierFields({ askedQuestion: asked, answer: text });
    if (ai.inputTokens > 0) {
      await store.logUsage({
        pageId: convo.page_id,
        conversationId: convo.id,
        model: env.gemini.model(),
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        latencyMs: ai.latencyMs,
      });
    }
    const fromModel = sanitizeExtracted(ai.fields, text);
    if (ai.intent !== "answer" && Object.keys(fromModel).length === 0) return notAnswer(ai.intent);
    return { fields: { ...det, ...fromModel }, intent: "answer" };
  } catch (err) {
    console.error(`[qualifier] สกัดด้วยโมเดลไม่สำเร็จ ใช้กติกาตายตัวแทน: ${(err as Error).message}`);
    return looksLikeQuestion(text) ? notAnswer("question") : { fields: det, intent: "answer" };
  }
}

export async function continueQualifier(
  convo: Conversation,
  contactId: string,
  text: string,
): Promise<BotAction> {
  const d = { ...(convo.lead_draft as unknown as Draft) };
  d.fields = { ...(d.fields ?? {}) };
  d.skipped = [...(d.skipped ?? [])];
  d.questions = [...(d.questions ?? [])];
  const pending = d.pending;
  const personal = pending === "name" || pending === "contact";

  // ── ช่องติดต่อ: ดึงเบอร์/LINE/อีเมลก่อนเสมอ (ห้ามให้คำอย่าง "โทรกลับ" แย่งไปเป็นคำขอนัด) ──
  if (pending === "contact") {
    const c = extractContact(text);
    const s = contactToString(c);
    if (s) {
      d.fields.contact = s;
      d.contactInfo = c;
      d.consentAt = new Date().toISOString(); // ยินยอม = ตอนลูกค้าให้เบอร์เอง หลังเห็นข้อความแจ้งแล้ว
      return askNext(convo, contactId, d);
    }
  }

  // ── ข้อความแทรก (จับด้วยโค้ด) ─────────────────────────────────────────
  const inter = detectInterjection(text, pending);
  switch (inter) {
    case "decline":
      if (personal) {
        return finishQualifier(convo, contactId, d, "ลูกค้าไม่สะดวกให้ช่องทางติดต่อ", EXTRA.declinedContact);
      }
      if (pending) d.skipped.push(pending);
      d.offTopic = 0;
      return askNext(convo, contactId, d, "ได้ครับ");
    case "appointment":
      return finishQualifier(convo, contactId, d, "ลูกค้าขอนัดคุย (บอตไม่รับนัดเอง)", EXTRA.appointment);
    case "negotiate":
      return finishQualifier(
        convo,
        contactId,
        d,
        "ลูกค้าต่อรองราคา/บอกว่าแพง",
        d.segment === "self_learn" ? EXTRA.negotiateTail : `${SCRIPT.expensive}\n${EXTRA.negotiateTail}`,
      );
    case "price_detail":
      return finishQualifier(convo, contactId, d, "ลูกค้าถามราคาละเอียด", EXTRA.priceDetail);
    case "price": {
      d.priceAsked = (d.priceAsked ?? 0) + 1;
      if (d.priceAsked >= 2) {
        return finishQualifier(convo, contactId, d, "ลูกค้าถามราคาซ้ำ", EXTRA.priceDetail);
      }
      const answer = d.segment === "self_learn" ? selfLearnPrice(d.recommended ?? []) : SCRIPT.price;
      return reAsk(convo, d, answer, "qualifier:price");
    }
    case "think_later":
      await save(convo.id, d);
      return reply(SCRIPT.thinkLater, "qualifier:think_later");
    case "has_it":
      return reAsk(convo, d, SCRIPT.hasIt, "qualifier:has_it");
    case "details":
      await save(convo.id, d);
      return reply(SCRIPT.details, "qualifier:details");
    default:
      break;
  }

  if (pending === "contact") {
    d.retries = (d.retries ?? 0) + 1;
    if (d.retries >= 2) {
      return finishQualifier(convo, contactId, d, "ช่องทางติดต่อที่ให้มาใช้ไม่ได้", EXTRA.toHuman);
    }
    await save(convo.id, d);
    return reply(EXTRA.contactRetry, "qualifier:retry_contact");
  }

  // ── สกัดค่าใส่ช่อง ───────────────────────────────────────────────────
  const { fields, intent } = await extract(convo, d, text);
  const allowed = fieldOrder(d.segment);
  const newly: QField[] = [];
  for (const [k, v] of Object.entries(fields) as [QField, string][]) {
    if (!allowed.includes(k) || k === "contact" || !v) continue;
    if (d.fields[k] && k !== pending) continue; // ไม่ทับค่าที่ได้แล้ว ยกเว้นช่องที่กำลังถาม
    d.fields[k] = v;
    d.skipped = d.skipped.filter((s) => s !== k);
    newly.push(k);
  }

  if (newly.length === 0) {
    d.offTopic = (d.offTopic ?? 0) + 1;
    if (intent === "question") d.questions.push(clip(text, 200));
    if (d.offTopic >= 2) {
      const reason = intent === "question" ? "ลูกค้ามีคำถามที่บอตตอบไม่ได้" : "ลูกค้าตอบนอกเรื่อง";
      return finishQualifier(convo, contactId, d, reason, EXTRA.toHuman);
    }
    const lead = intent === "question" ? EXTRA.questionNoted : EXTRA.offTopic;
    return reAsk(convo, d, lead, `qualifier:${intent === "question" ? "question" : "off_topic"}`);
  }
  d.offTopic = 0;

  // กลุ่มอยากเรียนเอง: ได้งานที่อยากใช้แล้ว → แนะนำคอร์สจาก MASTER ก่อนขอช่องทางติดต่อ
  if (d.segment === "self_learn" && newly.includes("use_case")) {
    const rec = selfLearnRecommendation(d.fields.use_case ?? text);
    d.recommended = rec.ids;
    return askNext(convo, contactId, d, rec.text);
  }

  return askNext(convo, contactId, d);
}

/**
 * ปิดโฟลว์: บันทึกผู้สนใจ + สรุปให้คน + แจ้ง LINE ต้น → โอนสาย
 * บันทึกไม่สำเร็จต้องไม่ทำให้ลูกค้าค้าง — สรุปยังไปอยู่ในแชท (ข้อความจากระบบ) และ LINE
 */
export async function finishQualifier(
  convo: Conversation,
  contactId: string,
  d: Draft,
  reason: string,
  customerText: string,
): Promise<BotAction> {
  const appUrl = env.appUrl();
  const link = appUrl ? `${appUrl}/admin/inbox/${convo.id}` : null;
  let summary = buildSummary(d, reason, link);

  const c = d.contactInfo ?? { phone: null, email: null, line: null };
  try {
    await store.saveLead({
      pageId: convo.page_id,
      conversationId: convo.id,
      contactId,
      name: d.fields.name ?? null,
      phone: c.phone,
      email: c.email,
      lineId: c.line,
      interest: d.fields.pain ?? d.fields.use_case ?? null,
      leadType: d.segment === "self_learn" ? "individual" : "corporate",
      consentAt: d.consentAt ?? null,
      note: summary,
      source: "messenger_ad",
      segment: d.segment,
      qualification: {
        button: d.button,
        revenueBand: d.revenueBand,
        fields: d.fields,
        skipped: d.skipped,
        questions: d.questions,
        recommended: d.recommended,
        reason,
      },
    });
  } catch (err) {
    console.error(`[qualifier] บันทึกผู้สนใจไม่สำเร็จ: ${(err as Error).message}`);
    summary += "\n⚠️ บันทึกลงตารางผู้สนใจไม่สำเร็จ — ข้อมูลอยู่ในข้อความนี้เท่านั้น";
  }

  await store.updateConversation(convo.id, { lead_step: null, lead_draft: {}, unread_for_admin: true });
  await notifyOwner(summary);

  return { kind: "handoff", text: customerText, reason: `โฟลว์คัดลูกค้า: ${reason}`, summary };
}
