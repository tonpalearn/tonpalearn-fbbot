/**
 * เทสต์โฟลว์คัดลูกค้าจากแอด ผ่านสมองบอตตัวจริง (handleIncoming)
 * ปลอมแค่ฐานข้อมูล โมเดล LINE และโปรไฟล์ Messenger — ตรวจ "สิ่งที่ลูกค้าเห็น" กับ "สิ่งที่บันทึก"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.GEMINI_API_KEY = "test";
process.env.DAILY_AI_CALL_CAP = "500";
process.env.NEXT_PUBLIC_APP_URL = "https://bot.example.test";

const state = {
  conversation: {
    id: "c1",
    page_id: "P1",
    contact_id: "u1",
    state: "bot_active" as string,
    lead_step: null as string | null,
    lead_draft: {} as Record<string, unknown>,
    last_user_message_at: null as string | null,
  },
  aiCallsToday: 0,
  savedLeads: [] as Record<string, unknown>[],
  patches: [] as Record<string, unknown>[],
  settings: {} as Record<string, string>,
};

vi.mock("@/lib/store", () => ({
  upsertContact: vi.fn(async () => "u1"),
  getOrCreateConversation: vi.fn(async () => state.conversation),
  saveMessage: vi.fn(async () => undefined),
  updateConversation: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    state.patches.push(patch);
    Object.assign(state.conversation, JSON.parse(JSON.stringify(patch)));
  }),
  getHistory: vi.fn(async () => []),
  isBotEnabled: vi.fn(async () => true),
  getActiveRules: vi.fn(async () => []),
  searchFaq: vi.fn(async () => []),
  searchKb: vi.fn(async () => []),
  getSetting: vi.fn(async (k: string, fallback: string) => state.settings[k] ?? fallback),
  saveLead: vi.fn(async (lead: Record<string, unknown>) => {
    state.savedLeads.push(lead);
  }),
  logHandoff: vi.fn(async () => undefined),
  logUsage: vi.fn(async () => undefined),
  countAiCallsToday: vi.fn(async () => state.aiCallsToday),
  bumpHit: vi.fn(async () => undefined),
}));

type Extract = {
  fields: Record<string, string>;
  intent: "answer" | "off_topic" | "question";
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};
const plain: Extract = { fields: {}, intent: "answer", inputTokens: 5, outputTokens: 5, latencyMs: 1 };
const extractMock = vi.fn(async (_p: { askedQuestion: string; answer: string }): Promise<Extract> => plain);
vi.mock("@/lib/ai", () => ({
  answerFromKnowledge: vi.fn(async () => ({ text: null, inputTokens: 0, outputTokens: 0, latencyMs: 0 })),
  extractQualifierFields: (p: { askedQuestion: string; answer: string }) => extractMock(p),
}));

const notifyMock = vi.fn(async (_t: string) => "sent" as const);
vi.mock("@/lib/notify", () => ({ notifyOwner: (t: string) => notifyMock(t) }));

const profileMock = vi.fn(async (_psid: string) => ({ first_name: "สมมติ", last_name: "ทดสอบ" }));
vi.mock("@/lib/facebook", () => ({ getUserProfile: (p: string) => profileMock(p) }));

const { handleIncoming, handleAttachment } = await import("@/lib/brain");
const Q = await import("@/lib/qualifier");
const { CASE_SHARE, painQuestion, SCRIPT, VOICE, CASES, FREE_CALL_LINE, allowedMoneyFigures } = Q;
const { extractRiskyFacts } = await import("@/lib/guard");

type Action = Awaited<ReturnType<typeof handleIncoming>>;
const say = (text: string) => handleIncoming({ pageId: "P1", psid: "u-psid", text, mid: `m${Math.random()}` });
async function chat(...lines: string[]) {
  const out: Action[] = [];
  for (const l of lines) out.push(await say(l));
  return out;
}
/** ข้อความทั้งหมดที่ลูกค้าจะเห็นจาก action หนึ่ง (ตามลำดับ) */
function texts(a: Action): string[] {
  if (a.kind === "multi") return a.parts.map((p) => p.text);
  if (a.kind === "handoff") return [...(a.pre ?? []).map((p) => p.text), a.text];
  if (a.kind === "text" || a.kind === "quick_replies") return [a.text];
  return [];
}
const all = (a: Action) => texts(a).join("\n");
const SLOTS = "ศุกร์ 20 พ.ย. 14:00\nอังคาร 24 พ.ย. 10:00";

function reset() {
  state.conversation = {
    id: "c1",
    page_id: "P1",
    contact_id: "u1",
    state: "bot_active",
    lead_step: null,
    lead_draft: {},
    last_user_message_at: null,
  };
  state.aiCallsToday = 0;
  state.savedLeads = [];
  state.patches = [];
  state.settings = {};
}

beforeEach(() => {
  reset();
  extractMock.mockReset();
  extractMock.mockResolvedValue(plain);
  notifyMock.mockClear();
  profileMock.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z")); // พฤหัส 19 พ.ย. 09:00 เวลาไทย
});

describe("4 ปุ่มยอดขาย → ด่าน 1 ตาม BOT-VOICE (มีปุ่ม)", () => {
  it.each([
    ["100 ล้านขึ้นไป", VOICE.taskQ],
    ["10–100 ล้าน", VOICE.taskQ],
    ["ต่ำกว่า 10 ล้าน", VOICE.taskQ], // บทเรียนแชทสด: ไม่บอกราคาก่อนลูกค้าถาม
    ["อยากเรียน AI เอง", SCRIPT.selfOpen],
  ])("%s", async (button, first) => {
    const out = await say(button);
    expect(out.kind).toBe("multi");
    expect(texts(out)[0]).toBe(first);
    expect(out.kind === "multi" && out.parts.some((p) => (p.replies?.length ?? 0) > 0)).toBe(true);
    expect(state.conversation.state).toBe("collecting_lead");
  });
});

describe("กลุ่ม 10M+ ถาม 4 ข้อ → ส่งต่อต้น", () => {
  it("ไม่มีช่องเวลาว่าง: งาน → ตรงไหนกินเวลา → ธุรกิจ → เคส + ขอเบอร์ → ยืนยัน + ส่งต่อ", async () => {
    const out = await chat(
      "100 ล้านขึ้นไป",
      "งานในโรงงาน",
      "ทีมบัญชีต้องรวมยอดจาก Excel หลายไฟล์ทุกสิ้นเดือน",
      "โรงงานผลิตอาหารแช่แข็ง",
      "081-234-5678",
    );
    expect(texts(out[1])).toEqual([painQuestion("งานในโรงงาน", false)]);
    expect(texts(out[1])[0]).toContain("รายงานผลิต"); // ถามเจาะตามงาน ไม่ยกคำลูกค้าใส่ "…"
    expect(texts(out[2])).toEqual([VOICE.businessType]);
    expect(texts(out[3])[0]).toContain("ที่ใกล้สุดที่ผมมีคือโรงสีครับ คนละอุตสาหกรรมกัน");
    expect(texts(out[3])[0]).not.toMatch(/^มีครับ/); // ไม่มีใครถาม ห้ามตอบ "มีครับ"
    expect(texts(out[3])[1]).toBe(VOICE.consentConsult);
    expect(out[4]).toMatchObject({ kind: "handoff", text: VOICE.doneConsult });
    expect(texts(out[4])[0]).toBe(VOICE.consentConfirm);
    // ไม่ถามชื่อ ไม่ถามขนาดทีม ไม่ถามตัดสินใจ/อยากเห็นผล
    expect(out.map(all).join("\n")).not.toMatch(/ชื่อ|กี่คน|ตัดสินใจ|อยากเห็นผล/);

    const lead = state.savedLeads[0];
    expect(lead).toMatchObject({ name: "สมมติ ทดสอบ", phone: "0812345678", segment: "big", source: "messenger_ad" });
    expect(lead.consentAt).toBeTruthy();
    const summary = notifyMock.mock.calls[0][0];
    expect(summary).toContain("ชื่อในโปรไฟล์: สมมติ ทดสอบ");
    expect(summary).toContain("ร่างตามรอบ 2");
    // ปัญหายาวเกิน 40 ตัว → ใช้คำงานที่ลูกค้าเลือกแทน ต้นกดส่งได้เลย
    expect(summary).toContain('ยังสนใจเรื่อง "งานในโรงงาน" อยู่ไหมครับ');
    expect(state.conversation).toMatchObject({ followup_draft: expect.stringContaining("ผมจะไม่ทักซ้ำ") });
  });

  it("มีช่องเวลาว่าง: ชวนนัดด่าน 4 + 'ขั้นตอนนี้ไม่มีค่าใช้จ่ายครับ' + เลือกเวลา → ขอเบอร์ → ยืนยันเวลา", async () => {
    state.settings.meeting_slots = SLOTS;
    const out = await chat("100 ล้านขึ้นไป", "สรุปตัวเลขผู้บริหาร", "รวมยอดขายจากหลายสาขา", "กลุ่มบริษัท 3 บริษัท");
    const invite = texts(out[3]);
    expect(invite[0]).toBe(CASE_SHARE.group);
    expect(invite).toHaveLength(2); // เคส + ชวนนัดในข้อความเดียว
    expect(invite[1]).toContain(SCRIPT.invite1);
    expect(invite[1]).toContain(FREE_CALL_LINE);
    expect(invite[1]).toContain("สะดวก ศุกร์ 20 พ.ย. 14:00 หรือ อังคาร 24 พ.ย. 10:00 ครับ");
    const tail = await chat("อังคาร 24 พ.ย. 10:00", "LINE: test.line");
    expect(texts(tail[0])).toEqual([VOICE.consentConsult]);
    expect(tail[1]).toMatchObject({ kind: "handoff", text: "อังคาร 24 พ.ย. 10:00 นะครับ เดี๋ยวผมส่งลิงก์ Zoom ให้ในแชทนี้" });
    expect(state.savedLeads[0]).toMatchObject({ lineId: "test.line" });
  });

  it("ไม่สะดวกทั้ง 2 เวลา → ถามช่วงที่สะดวก แล้วส่งต่อต้น", async () => {
    state.settings.meeting_slots = SLOTS;
    const out = await chat("100 ล้านขึ้นไป", "งานในโรงงาน", "นับสต็อก", "โรงสี", "ไม่สะดวกทั้งคู่");
    expect(out[4]).toMatchObject({ kind: "handoff", text: VOICE.slotNone });
  });
});

describe("(b) เจ้าของโรงงานถามตัวอย่าง แล้วถาม SI", () => {
  it("ตัวอย่าง (รู้ธุรกิจแล้ว) → เคส + ไม่เปิดชื่อ + ชวนคุย · SI → 2 ข้อความ + ปุ่ม IT · ไม่มี → ตอบก่อนแล้วไปต่อ", async () => {
    state.settings.meeting_slots = SLOTS;
    const out = await chat("10–100 ล้าน", "งานในโรงงาน", "วางแผนผลิตด้วยมือ", "โรงงานฉีดพลาสติก");
    reset();
    state.settings.meeting_slots = SLOTS;
    const o2 = await chat("10–100 ล้าน", "งานในโรงงาน", "มีตัวอย่างไหมครับ", "โรงงานฉีดพลาสติก");
    expect(texts(o2[2])).toEqual([VOICE.detailsUnknown]);
    const ex = texts(o2[3]);
    expect(ex[0]).toContain("คนละอุตสาหกรรมกัน");
    expect(ex[0]).toContain(VOICE.casePrivacy);
    expect(ex[1]).toContain(FREE_CALL_LINE);
    expect(out.length).toBe(4);

    const si = await say("SI?");
    expect(texts(si)).toEqual([VOICE.si1, VOICE.si2]);
    expect(si.kind === "multi" && si.parts[1].replies?.map((r) => r.title)).toEqual(["มีทีม IT", "ไม่มี"]);
    const no = await say("ไม่มี");
    expect(texts(no)[0]).toBe(VOICE.noIt);
  });

  it("ตัวอย่าง (ไม่มีช่องเวลาว่าง) → เคส + ไม่เปิดชื่อ + 'เดี๋ยวผมเข้ามาเสนอเวลา' แล้วส่งต่อ", async () => {
    const out = await chat("100 ล้านขึ้นไป", "ขอดูผลงานหน่อยครับ", "บริษัทประกันชีวิต");
    expect(out[2].kind).toBe("handoff");
    expect(texts(out[2])).toEqual([`${CASES.insurance.text}\n${VOICE.casePrivacy}`, expect.stringContaining("เดี๋ยวผมเข้ามาเสนอเวลาในแชทนี้")]);
    expect(all(out[2])).toContain(FREE_CALL_LINE);
  });
});

describe("(c) ถามว่าเป็นบอทไหม → ตอบตรงว่าเป็นระบบตอบอัตโนมัติ แล้วส่งต่อ", () => {
  it("กลางโฟลว์", async () => {
    const out = await chat("100 ล้านขึ้นไป", "นี่บอทตอบเหรอครับ");
    expect(out[1]).toMatchObject({ kind: "handoff", text: VOICE.isBot });
    expect(VOICE.isBot).toContain("ระบบตอบอัตโนมัติ");
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
  it("นอกโฟลว์ (ทักมาเฉย ๆ)", async () => {
    const out = await say("is this a bot?");
    expect(out).toMatchObject({ kind: "handoff", text: VOICE.isBot });
  });
});

describe("คำถามใหม่อื่น ๆ", () => {
  it("ภาพรวม (ไม่มีช่องเวลา) → 3 ขั้น + คุยฟรี + ส่งต่อ", async () => {
    const out = await chat("100 ล้านขึ้นไป", "ขอสรุปภาพรวมก่อนครับ");
    expect(texts(out[1])[0]).toBe(VOICE.overview);
    expect(all(out[1])).toContain(FREE_CALL_LINE);
    expect(out[1].kind).toBe("handoff");
  });

  it("วิธีทำ workflow → ของานจริง → คอร์ส AI Agentic + ถาม Online/Onsite → ราคา MASTER → ขอช่องทาง", async () => {
    const out = await chat("100 ล้านขึ้นไป", "อยากได้วิธีทำ workflow เลย", "ส่งอีเมลสรุปยอดทุกเช้า", "Online", "0812345678");
    expect(texts(out[1])).toEqual([VOICE.workflow1]);
    expect(texts(out[2])[0]).toBe("งานแบบนี้ อยู่ในคอร์ส AI Agentic 4 ชม. ครับ ในคลาสผมให้เอางานนี้มาทำด้วยกันเลย");
    expect(texts(out[2])).toContain(VOICE.workflowApps);
    expect(texts(out[2]).at(-1)).toBe(VOICE.format);
    expect(texts(out[3])[0]).toBe("• AI Agentic 4 ชม.\nOnline 4,500 · Onsite 7,000 · ท่านต่อไป 4,000 บาท");
    expect(texts(out[3])[1]).toBe(VOICE.consentSelf);
    expect(out[4]).toMatchObject({ kind: "handoff", text: VOICE.doneSelf });
  });

  it("กด 'อื่น ๆ พิมพ์เอง' → ข้อความชวนพิมพ์ ไม่นับเป็นคำตอบ", async () => {
    const out = await chat("100 ล้านขึ้นไป", "อื่น ๆ พิมพ์เอง");
    expect(texts(out[1])).toEqual([VOICE.typeOwn]);
    expect((state.conversation.lead_draft as { fields: object }).fields).toEqual({});
  });

  it("<10M กด 'อยากเรียนเอง' → เข้าโฟลว์อยากเรียนเอง", async () => {
    const out = await chat("ต่ำกว่า 10 ล้าน", "อยากเรียนเอง", "ทำแชตบอท");
    expect(texts(out[1])).toEqual([SCRIPT.selfOpen]);
    expect(texts(out[2])[0]).toContain("• LINE ChatBot 4 ชม. · ต้องผ่าน AI Agentic ก่อน");
  });
});

describe("ราคา · ขอนัด · ปฏิเสธเบอร์ · นอกเรื่อง", () => {
  it("ถามราคาครั้งแรก → ด่าน 5 คำต้น แล้วถามข้อเดิม · ถามซ้ำ → ส่งต่อ", async () => {
    const out = await chat("10–100 ล้าน", "ราคาเท่าไรครับ", "สรุปราคาเท่าไหร่ครับ");
    expect(texts(out[1])[0]).toBe(SCRIPT.price);
    expect(texts(out[1])[1]).toBe(VOICE.taskQSmall);
    expect(out[2]).toMatchObject({ kind: "handoff", text: VOICE.priceDetail });
  });

  it("ขอนัดไม่มีช่องเวลา → ส่งต่อ ไม่ทวนวันที่ลูกค้าเสนอ · มีช่องเวลา → เสนอ 2 ตัวเลือก", async () => {
    const a = await chat("100 ล้านขึ้นไป", "ขอนัดคุยวันพฤหัส 10 โมงได้ไหมครับ");
    expect(a[1]).toMatchObject({ kind: "handoff", text: VOICE.appointmentNoSlot });
    reset();
    state.settings.meeting_slots = SLOTS;
    const b = await chat("100 ล้านขึ้นไป", "ขอนัดคุยได้ไหมครับ");
    expect(b[1].kind).toBe("multi");
    expect(all(b[1])).toContain(FREE_CALL_LINE);
  });

  it("ปฏิเสธให้เบอร์ → ไม่ตื๊อ ไม่ลงเวลายินยอม ส่งต่อ", async () => {
    const out = await chat("100 ล้านขึ้นไป", "งานในโรงงาน", "นับสต็อก", "โรงสี", "ยังไม่อยากให้ครับ");
    expect(out[4]).toMatchObject({ kind: "handoff", text: VOICE.declinedContact });
    expect(state.savedLeads[0]).toMatchObject({ phone: null, lineId: null, consentAt: null });
  });

  it("นอกเรื่อง 2 ครั้งติด → ส่งต่อ", async () => {
    extractMock.mockResolvedValue({ ...plain, intent: "off_topic" });
    const out = await chat("100 ล้านขึ้นไป", "อากาศร้อนจัง", "ฝนจะตกไหม");
    expect(texts(out[1])[0]).toBe(VOICE.offTopic);
    expect(out[2]).toMatchObject({ kind: "handoff", text: VOICE.toHuman });
  });
});

describe("รั้วกันโมเดลแต่ง", () => {
  it("โมเดลยัดราคา/วันที่ → ไม่หลุดถึงลูกค้าและไม่ถูกบันทึก · ข้อความขาออกมีแต่ตัวเลขที่อนุญาต", async () => {
    extractMock.mockResolvedValue({
      ...plain,
      fields: { task: "แพ็กเกจ 9,900 บาท", pain: "ลด 30% ภายใน 15 ธันวาคม", reply: "ราคาพิเศษ 5,000 บาท" } as Record<string, string>,
    });
    const out = await chat("100 ล้านขึ้นไป", "ตอบแชทลูกค้า", "ตอบแชทซ้ำทุกวัน", "ร้านกาแฟ", "ไม่สะดวกครับ");
    const allowed = allowedMoneyFigures();
    for (const a of out) {
      for (const f of extractRiskyFacts(all(a))) expect(allowed).toContain(f);
      expect(all(a)).not.toMatch(/9,900|5,000|15 ธันวาคม/);
    }
    expect(JSON.stringify(state.savedLeads[0].qualification)).not.toMatch(/9,900|15 ธันวาคม|5,000/);
  });

  it("โมเดลล้ม / ถึงเพดาน → เดินต่อด้วยกติกาตายตัว", async () => {
    extractMock.mockRejectedValueOnce(new Error("429"));
    expect(texts((await chat("100 ล้านขึ้นไป", "งานในโรงงาน"))[1])).toEqual([painQuestion("งานในโรงงาน", false)]);
    reset();
    state.aiCallsToday = 9999;
    extractMock.mockClear();
    await chat("100 ล้านขึ้นไป", "งานในโรงงาน");
    expect(extractMock).not.toHaveBeenCalled();
  });
});

describe("บั๊กคำถามถูกเก็บเป็นชื่อ (โฟลว์ชื่อ-เบอร์เดิม)", () => {
  it("ระหว่างรอชื่อ ลูกค้าพิมพ์คำถาม → ไม่เก็บเป็นชื่อ ไม่ขอเบอร์ต่อ", async () => {
    state.conversation.state = "collecting_lead";
    state.conversation.lead_step = "name";
    state.conversation.lead_draft = { interest_seed: "สนใจ", lead_type: "individual" };
    const out = await say("ผมอยากได้แบบวิธีทำเลย");
    expect(state.conversation.lead_step).toBe("name");
    expect((state.conversation.lead_draft as { name?: string }).name).toBeUndefined();
    expect(all(out)).toContain("ขอชื่อก่อนครับ");
  });
});

describe("ส่งไฟล์มา", () => {
  it("→ บอกว่าได้รับ + ส่งต่อ · ระหว่างคนถือสาย → เงียบ", async () => {
    expect(await handleAttachment({ pageId: "P1", psid: "u", text: "", mid: "a1" })).toMatchObject({
      kind: "handoff",
      text: "ได้รับไฟล์แล้วครับ เดี๋ยวผมเปิดดูให้",
    });
    state.conversation.state = "human_active";
    expect((await handleAttachment({ pageId: "P1", psid: "u", text: "", mid: "a2" })).kind).toBe("silent");
  });
});

describe("ทักเข้ามาเอง ไม่ได้กดปุ่มแอด (บทเรียนแชทสด 18 พ.ย. 69)", () => {
  it("ทักทายเฉย ๆ → ข้อความเดียว ถามยอดขาย + 4 ปุ่ม · กดปุ่มแล้วเข้าโฟลว์ปกติ", async () => {
    const out = await chat("สวัสดีครับ", "100 ล้านขึ้นไป");
    expect(texts(out[0])).toEqual([VOICE.openHello]);
    expect(out[0].kind === "multi" && out[0].parts[0].replies?.map((r) => r.title)).toEqual([
      "ต่ำกว่า 10 ล้าน",
      "10–100 ล้าน",
      "100 ล้านขึ้นไป",
      "อยากเรียน AI เอง",
    ]);
    expect(texts(out[1])).toEqual([VOICE.taskQ]);
    expect(state.conversation.state).toBe("collecting_lead");
  });

  it("บอกงานมาเลย → สะท้อนคำลูกค้า + ถามข้อเดียว (ไม่ส่งเมนูบริการ ไม่บอกราคา)", async () => {
    const out = await chat("Automation โรงงาน", "ทำรายงานผลิตทุกเช้า", "โรงงานชิ้นส่วนพลาสติก", "0812345678");
    expect(texts(out[0])).toEqual([`เข้าใจครับ ${VOICE.pain}`]);
    expect(all(out[0])).not.toMatch(/Training|Consult|บาท/);
    expect(texts(out[1])).toEqual([VOICE.businessType]);
    expect(out[3].kind).toBe("handoff");
    expect(state.savedLeads[0]).toMatchObject({ segment: "open", phone: "0812345678" });
  });

  it("ข้อความแรกถาม SI → ตอบให้จบก่อน (ไม่โยนหาคนทันที)", async () => {
    const out = await say("เป็น SI เหรอครับ");
    expect(texts(out)).toEqual([VOICE.si1, VOICE.si2]);
    expect(state.conversation.state).toBe("collecting_lead");
  });

  it("ข้อความแรกขอภาพรวม → ส่งภาพรวมทันที (รับปากแล้วต้องส่ง)", async () => {
    const out = await say("ขอสรุปภาพรวมก่อนครับ");
    expect(all(out)).toContain(VOICE.overview);
  });

  it("ทักทาย แล้วพิมพ์ยอดขายเอง", async () => {
    const out = await chat("สนใจครับ", "ประมาณ 50 ล้าน");
    expect(texts(out[1])).toEqual([VOICE.taskQ]);
  });

  it("ทักทาย แล้วเล่างานแทนการตอบยอดขาย → ถือเป็นงาน แล้วถามต่อ", async () => {
    const out = await chat("สวัสดีครับ", "อยากให้ AI ช่วยตอบแชทลูกค้า");
    expect(texts(out[1])[0]).toMatch(/^เข้าใจครับ /);
  });
});

describe("แชททดลอง 19 พ.ย. — ต้องเป็นธรรมชาติขึ้น", () => {
  it("พิมพ์ 'อยากเรียนเอง แบบผู้บริหาร' ตอนถามงาน → ไปทางคอร์ส ไม่ถามเรื่อง Excel", async () => {
    const out = await chat("ต่ำกว่า 10 ล้าน", "อื่น ๆ พิมพ์เอง", "อยากเรียนเอง แบบผู้บริหาร");
    expect(all(out[2])).not.toMatch(/Excel|ทำงานนี้กันยังไง/);
    expect(all(out[2])).toContain(VOICE.selfIntro);
  });
  it("เล่าธุรกิจมาในคำตอบแล้ว → ไม่ถามธุรกิจซ้ำ", async () => {
    const out = await chat("ต่ำกว่า 10 ล้าน", "ตอบแชท/ตามลูกค้า", "ต้องการดูการบริหารธุรกิจจัดหางาน");
    expect(all(out[2])).not.toContain(VOICE.businessType);
  });
});
