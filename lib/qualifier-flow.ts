/**
 * ตัวเดินโฟลว์คัดลูกค้าจากแอด — ส่วนที่แตะฐานข้อมูล/โมเดล/LINE/โปรไฟล์ Messenger
 * ถ้อยคำและตรรกะล้วนอยู่ใน lib/qualifier.ts
 *
 * ลำดับ (ต้นเคาะ 18 พ.ย. 2569 · ถาม 4 ข้อ):
 *   งาน (ปุ่ม) → ตรงไหนกินเวลา → ธุรกิจ → เล่าเคสที่ใกล้สุด → ชวนนัด (ถ้ามีช่องเวลาว่าง) → เบอร์/LINE → ส่งต่อต้น
 *   กลุ่มอยากเรียนเอง: งานที่อยากใช้ (ปุ่ม) → แนะนำคอร์ส → เบอร์/LINE → ส่งต่อต้น
 * กติกาคำถามค้าง: ลูกค้าถามอะไร (ตัวอย่าง · SI · ภาพรวม · วิธีทำ · ราคา) ตอบให้จบก่อน แล้วค่อยถามข้อเดิมต่อ
 */
import { env } from "./env";
import { extractQualifierFields } from "./ai";
import { notifyOwner } from "./notify";
import { getUserProfile } from "./facebook";
import * as store from "./store";
import type { Conversation } from "./store";
import type { BotAction } from "./brain";
import {
  FREE_CALL_LINE,
  FREE_FIRST_CALL,
  IT_BUTTONS,
  OTHER_TITLE,
  SCRIPT,
  SELF_BUTTON_TITLE,
  TASK_BUTTONS,
  TASK_BUTTONS_SMALL,
  THINK_BUTTONS,
  USECASE_BUTTONS,
  REVENUE_BUTTONS,
  VOICE,
  buildSummary,
  contactToString,
  deterministicExtract,
  detectInterjection,
  extractContact,
  inviteNoSlot,
  inviteParts,
  looksLikeQuestion,
  newDraft,
  openingParts,
  pickCase,
  priceText,
  painQuestion,
  shareCase,
  wantsToLearn,
  businessFromText,
  isGreetingOnly,
  detectAdEntry,
  roundTwoDraft,
  sanitizeExtracted,
  selfLearnPrice,
  selfLearnRecommendation,
  slotButtons,
  usableSlots,
  workflowParts,
  type AdEntry,
  type ContactInfo,
  type OutPart,
  type QField,
  type QualDraft,
} from "./qualifier";
import { coursePriceLine, courseById } from "./courses";

type Draft = QualDraft & { contactInfo?: ContactInfo };
export interface QualCtx {
  contactId: string;
  psid: string;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const freeLead = () => (FREE_FIRST_CALL ? `${FREE_CALL_LINE}\n` : "");
const twoSlots = (s: string[]) => `สะดวก ${s[0]} หรือ ${s[1]} ครับ โทรหรือ Zoom ก็ได้`;

async function save(convoId: string, d: Draft): Promise<void> {
  await store.updateConversation(convoId, {
    state: "collecting_lead",
    lead_step: d.pending ? `q:${d.pending}` : null,
    lead_draft: d as unknown as Record<string, unknown>,
  });
}

function multi(parts: OutPart[], source: string): BotAction {
  return { kind: "multi", parts: parts.filter((p) => p.text.trim() !== ""), source };
}

async function getSlots(): Promise<string[]> {
  return usableSlots(await store.getSetting("meeting_slots", ""));
}

export async function startQualifier(convo: Conversation, entry: AdEntry): Promise<BotAction> {
  const open = openingParts(entry);
  const d: Draft = newDraft(entry, open.pending);
  await save(convo.id, d);
  return multi(open.parts, `qualifier:open:${entry.segment}`);
}

/**
 * ทักเข้ามาเอง ไม่ได้กดปุ่มแอด (บทเรียนแชทสด 18 พ.ย. 69):
 *  - ทักทายเฉย ๆ → ข้อความเดียว ถามยอดขาย + ปุ่ม 4 ปุ่ม (ไม่ส่งเมนูบริการ ไม่ส่งหลายข้อความซ้อน)
 *  - บอกงาน/ถามมาเลย → เก็บเป็น "งาน" แล้วสะท้อนคำของลูกค้ากลับ + ถามข้อเดียว (หรือตอบคำถามแทรกก่อน)
 */
export async function startOpenQualifier(convo: Conversation, ctx: QualCtx, text: string): Promise<BotAction> {
  const button = `(พิมพ์เอง) ${clip(text, 60)}`;
  if (isGreetingOnly(text)) return startQualifier(convo, { segment: "open", button, revenueBand: null });
  const d: Draft = newDraft({ segment: "open", button, revenueBand: null }, "task");
  await save(convo.id, d);
  return continueQualifier({ ...convo, state: "collecting_lead", lead_draft: d as unknown as Record<string, unknown> }, ctx, text);
}

/** ข้อความถามของช่องที่รออยู่ (ใช้ถามซ้ำหลังตอบคำถามแทรก) */
function pendingQuestion(d: Draft, slots: string[]): OutPart | null {
  switch (d.pending) {
    case "task":
      return d.segment === "small"
        ? { text: VOICE.taskQSmall, replies: TASK_BUTTONS_SMALL }
        : { text: VOICE.taskQSmall, replies: TASK_BUTTONS };
    case "pain":
      return { text: VOICE.pain };
    case "business_type":
      return { text: VOICE.businessType };
    case "use_case":
      return { text: VOICE.useCase, replies: USECASE_BUTTONS };
    case "format":
      return { text: VOICE.format };
    case "slot":
      return slots.length === 2 ? { text: twoSlots(slots), replies: slotButtons(slots) } : null;
    case "contact":
      return { text: d.segment === "self_learn" ? VOICE.consentSelf : VOICE.consentConsult };
    case "it_team":
      return { text: "ตอนนี้ในบริษัทมีทีม IT ไหมครับ", replies: IT_BUTTONS };
    case "workflow_task":
      return { text: VOICE.workflow1 };
    case "revenue":
      return { text: VOICE.openHello, replies: REVENUE_BUTTONS };
    default:
      return null;
  }
}

/** ตอบคำถามแทรกเสร็จ แล้วถามข้อเดิมต่อ */
async function reAsk(convo: Conversation, ctx: QualCtx, d: Draft, lead: OutPart[], source: string): Promise<BotAction> {
  const slots = await getSlots();
  const q = pendingQuestion(d, slots);
  if (!q) return advance(convo, ctx, d, lead);
  await save(convo.id, d);
  return multi([...lead, q], source);
}

/** เดินไปขั้นถัดไปตามช่องที่ยังขาด */
async function advance(convo: Conversation, ctx: QualCtx, d: Draft, lead: OutPart[] = []): Promise<BotAction> {
  const ask = async (pending: Draft["pending"], part: OutPart, source: string) => {
    d.pending = pending;
    d.retries = 0;
    await save(convo.id, d);
    return multi([...lead, part], source);
  };
  const has = (f: QField) => Boolean(d.fields[f]) || d.skipped.includes(f);

  if (d.segment === "self_learn") {
    if (!has("use_case")) return ask("use_case", { text: VOICE.useCase, replies: USECASE_BUTTONS }, "qualifier:ask:use_case");
    if (!has("contact")) return ask("contact", { text: VOICE.consentSelf }, "qualifier:ask:contact");
    return finishQualifier(convo, ctx, d, "ได้ข้อมูลครบ", [...lead, { text: VOICE.consentConfirm }, { text: VOICE.doneSelf }]);
  }

  // ลูกค้าถามหาตัวอย่างไว้ และตอนนี้รู้ธุรกิจแล้ว → ตอบให้จบก่อนถามข้ออื่น (กติกาคำถามค้าง)
  const answerCaseFirst = d.wantCase && Boolean(d.fields.business_type) && !d.caseShown;
  if (!answerCaseFirst && !has("task")) {
    const part = d.segment === "small"
      ? { text: VOICE.taskQSmall, replies: TASK_BUTTONS_SMALL }
      : { text: VOICE.taskQSmall, replies: TASK_BUTTONS };
    return ask("task", part, "qualifier:ask:task");
  }
  if (!answerCaseFirst && !has("pain")) {
    // ลูกค้าพิมพ์งานมาละเอียดแล้ว → ใช้ด่าน 2 ข้อ 1 ของต้นแทน
    const detailed = (d.fields.task ?? "").length >= 25;
    // ถามเจาะตามงานที่เลือก (บทเรียนแชทสด: ลูกค้าบอกเรื่องเฉพาะ อย่าตอบกว้าง · ต้นติ: อย่ายกคำลูกค้าใส่ "…")
    return ask("pain", { text: painQuestion(d.fields.task, detailed) }, "qualifier:ask:pain");
  }
  if (!answerCaseFirst && !has("business_type")) return ask("business_type", { text: VOICE.businessType }, "qualifier:ask:business_type");

  const slots = await getSlots();
  if (!d.caseShown && d.fields.business_type) {
    // ลูกค้าถามหาตัวอย่างเอง → "มีครับ …" · บอตเล่าเอง → "งานคล้ายกันที่ผมทำ …"
    const c = d.wantCase ? pickCase(d.fields.business_type) : shareCase(d.fields.business_type);
    d.caseShown = true;
    d.caseKey = c.key;
    if (d.wantCase) {
      // ลูกค้าถามหาตัวอย่างเอง → เคส + เรื่องชื่อลูกค้าในข้อความเดียว แล้วชวนนัด (ไม่ส่งซ้อน 3 ข้อความ)
      lead = [...lead, { text: `${c.text}\n${VOICE.casePrivacy}` }];
      d.wantCase = false;
      if (slots.length !== 2) {
        return finishQualifier(convo, ctx, d, "ลูกค้าขอตัวอย่างงาน · ยังไม่มีช่องเวลาว่างให้เสนอ", [
          ...lead,
          { text: inviteNoSlot(VOICE.caseInviteSlotLead) },
        ]);
      }
      d.meetingOffered = true;
      d.offeredSlots = slots;
      return ask(
        "slot",
        { text: `${VOICE.caseInviteSlotLead}\n${freeLead()}${twoSlots(slots)}`, replies: slotButtons(slots) },
        "qualifier:invite",
      );
    }
    lead = [...lead, { text: c.text }];
  }

  if (!d.meetingOffered && !d.fields.slot && slots.length === 2) {
    d.meetingOffered = true;
    d.offeredSlots = slots;
    const [invite] = inviteParts(slots);
    return ask("slot", invite, "qualifier:invite");
  }
  if (!has("contact")) return ask("contact", { text: VOICE.consentConsult }, "qualifier:ask:contact");

  const done = d.fields.slot ? `${d.fields.slot} นะครับ เดี๋ยวผมส่งลิงก์ Zoom ให้ในแชทนี้` : VOICE.doneConsult;
  return finishQualifier(convo, ctx, d, d.fields.slot ? `ได้ข้อมูลครบ · เลือกเวลา ${d.fields.slot}` : "ได้ข้อมูลครบ", [
    ...lead,
    { text: VOICE.consentConfirm },
    { text: done },
  ]);
}

async function canUseModel(pageId: string): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  const used = await store.countAiCallsToday(pageId);
  return used < env.brain.dailyAiCallCap();
}

/** สกัดค่า: กติกาตายตัวก่อน แล้วให้โมเดลช่วยแยกช่อง · โมเดลล้ม/ถึงเพดาน = ใช้กติกาตายตัว */
async function extract(
  convo: Conversation,
  d: Draft,
  text: string,
): Promise<{ fields: Partial<Record<QField, string>>; intent: "answer" | "off_topic" | "question" }> {
  const det = deterministicExtract(text, d.pending);
  const notAnswer = (intent: "off_topic" | "question") => ({ fields: {}, intent });

  if (!(await canUseModel(convo.page_id))) {
    return looksLikeQuestion(text) ? notAnswer("question") : { fields: det, intent: "answer" };
  }
  try {
    const q = pendingQuestion(d, []);
    const ai = await extractQualifierFields({ askedQuestion: q?.text ?? "", answer: text });
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

export async function continueQualifier(convo: Conversation, ctx: QualCtx, text: string): Promise<BotAction> {
  const d = { ...(convo.lead_draft as unknown as Draft) };
  d.fields = { ...(d.fields ?? {}) };
  d.skipped = [...(d.skipped ?? [])];
  d.questions = [...(d.questions ?? [])];
  d.offeredSlots = [...(d.offeredSlots ?? [])];
  let pending = d.pending;
  const slots = await getSlots();
  const trimmed = text.trim();

  // ── ทักเอง → ตอบยอดขาย (ปุ่ม หรือพิมพ์ตัวเลข) ─────────────────────────
  if (pending === "revenue") {
    const entry = detectAdEntry(text);
    if (entry && entry.segment !== "details") {
      d.segment = entry.segment;
      d.revenueBand = entry.revenueBand;
      d.button = `${d.button} → ${entry.button}`;
      if (entry.segment === "self_learn") {
        d.pending = "use_case";
        await save(convo.id, d);
        return multi([{ text: SCRIPT.selfOpen, replies: USECASE_BUTTONS }], "qualifier:open:self_learn");
      }
      d.pending = "task";
      await save(convo.id, d);
      return multi(
        [{ text: VOICE.taskQ, replies: entry.segment === "small" ? TASK_BUTTONS_SMALL : TASK_BUTTONS }],
        `qualifier:open:${entry.segment}`,
      );
    }
    // ไม่ได้ตอบยอดขาย แต่เล่างาน/ถามมา → ถือเป็นคำตอบช่อง "งาน" (ยอดขายไปถามตอนคุย)
    pending = "task";
    d.pending = "task";
  }

  // ── ช่องติดต่อ: ดึงเบอร์/LINE/อีเมลก่อนเสมอ ───────────────────────────
  if (pending === "contact") {
    const c = extractContact(text);
    const s = contactToString(c);
    if (s) {
      d.fields.contact = s;
      d.contactInfo = c;
      d.consentAt = new Date().toISOString();
      return advance(convo, ctx, d);
    }
  }

  // ── ข้อความแทรก ──────────────────────────────────────────────────────
  const inter = detectInterjection(text, pending);
  switch (inter) {
    case "is_bot":
      // ต้องตอบตรงเสมอว่าเป็นระบบตอบอัตโนมัติ แล้วส่งต่อต้นทันที
      return finishQualifier(convo, ctx, d, "ลูกค้าถามว่าคุยกับบอทหรือคน", [{ text: VOICE.isBot }]);
    case "old_customer":
      return finishQualifier(convo, ctx, d, "ลูกค้าขอติดต่อลูกค้าเก่า (บอตรับปากไม่ได้)", [{ text: VOICE.oldCustomerContact }]);
    case "decline":
      if (pending === "slot") {
        return finishQualifier(convo, ctx, d, "ลูกค้าไม่สะดวกเวลาที่เสนอ", [{ text: VOICE.slotNone }]);
      }
      if (pending === "contact") {
        return finishQualifier(convo, ctx, d, "ลูกค้ายังไม่สะดวกให้ช่องทางติดต่อ", [{ text: VOICE.declinedContact }]);
      }
      if (pending && ["task", "pain", "business_type", "use_case"].includes(pending)) d.skipped.push(pending as QField);
      d.offTopic = 0;
      return advance(convo, ctx, d, [{ text: "ได้ครับ" }]);
    case "appointment":
      if (slots.length === 2 && !d.fields.slot) {
        d.meetingOffered = true;
        d.offeredSlots = slots;
        d.pending = "slot";
        await save(convo.id, d);
        return multi([{ text: `ได้เลยครับ ${freeLead()}${twoSlots(slots)}`, replies: slotButtons(slots) }], "qualifier:appointment");
      }
      return finishQualifier(convo, ctx, d, "ลูกค้าขอนัดคุย (ยังไม่มีช่องเวลาว่างในตั้งค่า)", [{ text: VOICE.appointmentNoSlot }]);
    case "negotiate":
      return finishQualifier(
        convo,
        ctx,
        d,
        "ลูกค้าต่อรองราคา/บอกว่าแพง",
        d.segment === "self_learn" ? [{ text: VOICE.negotiateTail }] : [{ text: SCRIPT.expensive }, { text: VOICE.negotiateTail }],
      );
    case "price_detail":
      return finishQualifier(convo, ctx, d, "ลูกค้าถามราคาละเอียด", [{ text: VOICE.priceDetail }]);
    case "price": {
      d.priceAsked = (d.priceAsked ?? 0) + 1;
      if (d.priceAsked >= 2) return finishQualifier(convo, ctx, d, "ลูกค้าถามราคาซ้ำ", [{ text: VOICE.priceDetail }]);
      d.priceShown = true;
      const answer = d.segment === "self_learn" ? selfLearnPrice(d.recommended ?? []) : priceText();
      return reAsk(convo, ctx, d, [{ text: answer }], "qualifier:price");
    }
    case "references":
    case "tell_case":
      if (d.fields.business_type) {
        d.caseShown = false;
        d.wantCase = true;
        return advance(convo, ctx, d);
      }
      d.wantCase = true;
      d.pending = "business_type";
      await save(convo.id, d);
      return multi([{ text: VOICE.detailsUnknown }], "qualifier:references");
    case "si":
      d.pending = "it_team";
      await save(convo.id, d);
      return multi([{ text: VOICE.si1 }, { text: VOICE.si2, replies: IT_BUTTONS }], "qualifier:si");
    case "overview":
      d.priceShown = true;
      if (slots.length === 2 && !d.fields.slot) {
        d.meetingOffered = true;
        d.offeredSlots = slots;
        d.pending = "slot";
        await save(convo.id, d);
        return multi(
          [{ text: VOICE.overview }, { text: `${VOICE.overviewSlotLead}\n${freeLead()}${twoSlots(slots)}`, replies: slotButtons(slots) }],
          "qualifier:overview",
        );
      }
      return finishQualifier(convo, ctx, d, "ลูกค้าขอภาพรวม · ยังไม่มีช่องเวลาว่างให้เสนอ", [
        { text: VOICE.overview },
        { text: inviteNoSlot(VOICE.overviewSlotLead) },
      ]);
    case "workflow":
      d.pending = "workflow_task";
      await save(convo.id, d);
      return multi([{ text: VOICE.workflow1 }], "qualifier:workflow");
    case "think_later":
      d.pending = "think_reason";
      await save(convo.id, d);
      return multi([{ text: SCRIPT.thinkLater, replies: THINK_BUTTONS }], "qualifier:think_later");
    case "has_it":
      return reAsk(convo, ctx, d, [{ text: SCRIPT.hasIt }], "qualifier:has_it");
    case "can_build":
      // ตอบให้จบก่อน แล้วถามข้อเดิมต่อ (ถ้ารอเลือกเวลาอยู่ ก็เสนอ 2 เวลาเดิมอีกครั้ง)
      return reAsk(convo, ctx, d, [{ text: VOICE.canBuild }], "qualifier:can_build");
    default:
      break;
  }

  // ── คำตอบของคำถามย่อย ────────────────────────────────────────────────
  switch (pending) {
    case "contact": {
      d.retries = (d.retries ?? 0) + 1;
      if (d.retries >= 2) return finishQualifier(convo, ctx, d, "ช่องทางติดต่อที่ให้มาใช้ไม่ได้", [{ text: VOICE.toHuman }]);
      await save(convo.id, d);
      return multi([{ text: VOICE.contactRetry }], "qualifier:retry_contact");
    }
    case "slot": {
      const picked = d.offeredSlots.find((s) => trimmed === s || trimmed === s.slice(0, 20) || trimmed.includes(s));
      if (!picked && looksLikeQuestion(text)) {
        // ถามอย่างอื่นระหว่างรอเลือกเวลา ≠ ไม่สะดวก → จดคำถามไว้ให้ต้น แล้วเสนอเวลาเดิมอีกครั้ง (ไม่ปิดห้องเงียบ ๆ)
        d.questions.push(clip(text, 200));
        await save(convo.id, d);
        return multi(
          [{ text: VOICE.questionNoted }, { text: twoSlots(d.offeredSlots), replies: slotButtons(d.offeredSlots) }],
          "qualifier:slot_question",
        );
      }
      if (!picked) {
        return finishQualifier(convo, ctx, d, "ลูกค้าไม่สะดวกเวลาที่เสนอ", [{ text: VOICE.slotNone }]);
      }
      d.fields.slot = picked;
      return advance(convo, ctx, d);
    }
    case "it_team": {
      const none = /ไม่มี|ไม่ได้มี|no/i.test(trimmed);
      d.pending = null;
      return advance(convo, ctx, d, [{ text: none ? VOICE.noIt : SCRIPT.hasIt }]);
    }
    case "think_reason":
      return finishQualifier(convo, ctx, d, `ลูกค้าขอคิดก่อน · ติด${clip(trimmed, 40)}`, [{ text: VOICE.toHuman }]);
    case "workflow_task": {
      const w = workflowParts(trimmed);
      d.segment = "self_learn";
      d.fields.use_case = clip(trimmed, 300);
      d.recommended = w.ids;
      d.pending = "format";
      await save(convo.id, d);
      return multi(w.parts, "qualifier:workflow_course");
    }
    case "format": {
      d.fields.format = /onsite|ออฟฟิศ|ที่บริษัท|ออนไซต์/i.test(trimmed) ? "Onsite" : /online|ออนไลน์|zoom/i.test(trimmed) ? "Online" : clip(trimmed, 40);
      d.priceShown = true;
      const course = courseById(d.recommended[0] ?? "");
      d.pending = null;
      return advance(convo, ctx, d, course ? [{ text: coursePriceLine(course) }] : []);
    }
    default:
      break;
  }

  // ── ปุ่ม "อื่น ๆ พิมพ์เอง" / "อยากเรียนเอง" ───────────────────────────
  if (trimmed === OTHER_TITLE && (pending === "task" || pending === "use_case")) {
    await save(convo.id, d);
    return multi([{ text: VOICE.typeOwn }], "qualifier:type_own");
  }
  if (trimmed === SELF_BUTTON_TITLE && pending === "task") {
    d.segment = "self_learn";
    d.pending = "use_case";
    await save(convo.id, d);
    return multi([{ text: SCRIPT.selfOpen, replies: USECASE_BUTTONS }], "qualifier:to_self_learn");
  }

  // ── สกัดค่าใส่ช่อง ───────────────────────────────────────────────────
  const { fields, intent } = await extract(convo, d, text);
  const allowed: QField[] = d.segment === "self_learn" ? ["use_case"] : ["task", "pain", "business_type"];
  const newly: QField[] = [];
  for (const [k, v] of Object.entries(fields) as [QField, string][]) {
    if (!allowed.includes(k) || !v) continue;
    if (d.fields[k] && k !== pending) continue;
    d.fields[k] = v;
    d.skipped = d.skipped.filter((s) => s !== k);
    newly.push(k);
  }

  if (newly.length === 0) {
    d.offTopic = (d.offTopic ?? 0) + 1;
    if (intent === "question") d.questions.push(clip(text, 200));
    if (d.offTopic >= 2) {
      const reason = intent === "question" ? "ลูกค้ามีคำถามที่บอตตอบไม่ได้" : "ลูกค้าตอบนอกเรื่อง";
      return finishQualifier(convo, ctx, d, reason, [{ text: VOICE.toHuman }]);
    }
    const lead = intent === "question" ? VOICE.questionNoted : VOICE.offTopic;
    return reAsk(convo, ctx, d, [{ text: lead }], `qualifier:${intent === "question" ? "question" : "off_topic"}`);
  }
  d.offTopic = 0;
  d.pending = null;

  // พิมพ์เองว่า "อยากเรียน…" ตอนถามงาน → ไปทางคอร์ส ไม่ถามเรื่อง Excel/ระบบต่อ (เจอในแชททดลอง 19 พ.ย.)
  if (d.segment !== "self_learn" && newly.includes("task") && wantsToLearn(d.fields.task ?? "")) {
    d.segment = "self_learn";
    d.fields.use_case = d.fields.task;
    const rec = selfLearnRecommendation(d.fields.use_case ?? text);
    d.recommended = rec.ids;
    return advance(convo, ctx, d, rec.parts);
  }
  // ลูกค้าเล่าธุรกิจมาในคำตอบแล้ว → ไม่ถาม "ธุรกิจทำเกี่ยวกับอะไร" ซ้ำ
  if (!d.fields.business_type && (newly.includes("pain") || newly.includes("task"))) {
    const biz = businessFromText(text); // เฉพาะคำที่ลูกค้าพิมพ์รอบนี้ (ไม่ใช่ชื่อปุ่ม)
    if (biz) d.fields.business_type = biz;
  }

  if (d.segment === "self_learn" && newly.includes("use_case")) {
    const rec = selfLearnRecommendation(d.fields.use_case ?? text);
    d.recommended = rec.ids;
    return advance(convo, ctx, d, rec.parts);
  }
  return advance(convo, ctx, d);
}

/** ชื่อจากโปรไฟล์ Messenger (ไม่ถามในแชท) — ดึงไม่ได้ = ว่าง */
async function profileName(psid: string): Promise<string | null> {
  try {
    const p = await getUserProfile(psid);
    const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return n || null;
  } catch {
    return null;
  }
}

/**
 * ปิดโฟลว์: บันทึกผู้สนใจ + ร่างตามรอบ 2 + สรุปให้ต้น (แชท + LINE) → โอนสาย
 * parts: ข้อความสุดท้ายถึงลูกค้า (ข้อความท้ายสุดคือข้อความโอนสาย)
 */
export async function finishQualifier(
  convo: Conversation,
  ctx: QualCtx,
  d: Draft,
  reason: string,
  parts: OutPart[],
): Promise<BotAction> {
  const appUrl = env.appUrl();
  const link = appUrl ? `${appUrl}/admin/inbox/${convo.id}` : null;
  const name = await profileName(ctx.psid);
  const draft = roundTwoDraft(d);
  let summary = buildSummary(d, reason, link, name, draft);

  const c = d.contactInfo ?? { phone: null, email: null, line: null };
  try {
    await store.saveLead({
      pageId: convo.page_id,
      conversationId: convo.id,
      contactId: ctx.contactId,
      name,
      phone: c.phone,
      email: c.email,
      lineId: c.line,
      interest: d.fields.pain ?? d.fields.task ?? d.fields.use_case ?? null,
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
        caseKey: d.caseKey,
        reason,
      },
    });
  } catch (err) {
    console.error(`[qualifier] บันทึกผู้สนใจไม่สำเร็จ: ${(err as Error).message}`);
    summary += "\n⚠️ บันทึกลงตารางผู้สนใจไม่สำเร็จ — ข้อมูลอยู่ในข้อความนี้เท่านั้น";
  }

  await store.updateConversation(convo.id, {
    lead_step: null,
    lead_draft: {},
    unread_for_admin: true,
    followup_draft: draft,
    followup_draft_at: new Date().toISOString(),
  });
  await notifyOwner(summary);

  const clean = parts.filter((p) => p.text.trim() !== "");
  const last = clean[clean.length - 1] ?? { text: VOICE.toHuman };
  return {
    kind: "handoff",
    pre: clean.slice(0, -1),
    text: last.text,
    reason: `โฟลว์คัดลูกค้า: ${reason}`,
    summary,
  };
}
