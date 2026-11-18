/**
 * เทสต์โฟลว์คัดลูกค้าจากแอด ผ่านสมองบอตตัวจริง (handleIncoming)
 * ปลอมแค่ฐานข้อมูล โมเดล และ LINE — ตรวจ "สิ่งที่ลูกค้าเห็น" กับ "สิ่งที่บันทึก" จริง
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
  usage: 0,
};

vi.mock("@/lib/store", () => ({
  upsertContact: vi.fn(async () => "u1"),
  getOrCreateConversation: vi.fn(async () => state.conversation),
  saveMessage: vi.fn(async () => undefined),
  updateConversation: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    // จำลอง jsonb: เก็บสำเนา ไม่ใช่ตัวอ้างอิงเดิม
    Object.assign(state.conversation, JSON.parse(JSON.stringify(patch)));
  }),
  getHistory: vi.fn(async () => []),
  isBotEnabled: vi.fn(async () => true),
  getActiveRules: vi.fn(async () => []),
  searchFaq: vi.fn(async () => []),
  searchKb: vi.fn(async () => []),
  getSetting: vi.fn(async (_k: string, fallback: string) => fallback),
  saveLead: vi.fn(async (lead: Record<string, unknown>) => {
    state.savedLeads.push(lead);
  }),
  logHandoff: vi.fn(async () => undefined),
  logUsage: vi.fn(async () => {
    state.usage += 1;
  }),
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
/** ค่าเริ่มต้น: โมเดลตอบว่า "ตอบคำถาม" แต่ไม่ได้แยกช่องให้ → ใช้ผลกติกาตายตัว */
const extractMock = vi.fn(
  async (_p: { askedQuestion: string; answer: string }): Promise<Extract> => ({
    fields: {},
    intent: "answer",
    inputTokens: 5,
    outputTokens: 5,
    latencyMs: 1,
  }),
);
const kbMock = vi.fn(async () => ({ text: null, inputTokens: 0, outputTokens: 0, latencyMs: 0 }));
vi.mock("@/lib/ai", () => ({
  answerFromKnowledge: (...a: unknown[]) => kbMock(...(a as [])),
  extractQualifierFields: (p: { askedQuestion: string; answer: string }) => extractMock(p),
}));

const notifyMock = vi.fn(async (_t: string) => "sent" as const);
vi.mock("@/lib/notify", () => ({ notifyOwner: (t: string) => notifyMock(t) }));

const { handleIncoming } = await import("@/lib/brain");
const { SCRIPT, EXTRA, allowedMoneyFigures } = await import("@/lib/qualifier");
const { extractRiskyFacts } = await import("@/lib/guard");

const say = (text: string) =>
  handleIncoming({ pageId: "P1", psid: "u-psid", text, mid: `m${Math.random()}` });

/** คุยหลายข้อความต่อกัน แล้วคืนสิ่งที่บอตตอบทีละข้อ */
async function chat(...lines: string[]) {
  const out = [];
  for (const l of lines) out.push(await say(l));
  return out;
}

const textOf = (a: { kind: string; text?: string }) => ("text" in a ? (a.text ?? "") : "");

beforeEach(() => {
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
  state.usage = 0;
  extractMock.mockClear();
  notifyMock.mockClear();
  kbMock.mockClear();
});

describe("ด่าน 1 — 4 ปุ่มยอดขาย ได้ถ้อยคำตามสคริปต์ ไม่โยนหาคนทันที", () => {
  it.each([
    ["100 ล้านขึ้นไป", SCRIPT.bigOpen],
    ["10–100 ล้าน", SCRIPT.bigOpen],
    ["ต่ำกว่า 10 ล้าน", SCRIPT.smallOpen],
    ["อยากเรียน AI เอง", SCRIPT.selfOpen],
  ])("%s", async (button, expected) => {
    const out = await say(button);
    expect(out).toMatchObject({ kind: "text", text: expected });
    expect(state.conversation.state).toBe("collecting_lead");
    expect(kbMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ขอรายละเอียด/ตัวอย่างงาน → ลิงก์ portfolio ตามด่าน 6 แล้วถามเรื่องธุรกิจต่อ", async () => {
    const [first, second] = await chat("ขอราบละเอียดบริการ และกรณีตัวอย่างที่ทำแล้วได้ไหมครับ", "ร้านอาหาร 3 สาขาครับ");
    expect(textOf(first)).toBe(SCRIPT.details);
    expect(textOf(first)).toContain("tonpalearn.com/portfolio");
    // ได้ธุรกิจแล้ว แต่ "3 สาขา" ไม่ใช่ขนาดทีม → ถามขนาดทีมต่อ
    expect(textOf(second)).toBe(EXTRA.teamSize);
  });
});

describe("กลุ่มหลัก — ถามทีละข้อจนครบ แล้วบันทึก + แจ้งต้น + ส่งให้คน", () => {
  it("เดินครบ 7 ช่อง", async () => {
    const out = await chat(
      "100 ล้านขึ้นไป",
      "โรงงานผลิตอาหารแช่แข็ง ทีมประมาณ 40 คนครับ",
      "ทีมบัญชีต้องรวมยอดจาก Excel หลายไฟล์ทุกสิ้นเดือน",
      "ผมตัดสินใจเองได้ครับ",
      "ภายใน 2 เดือนครับ",
      "เอก",
      "081-234-5678",
    );
    expect(textOf(out[1])).toBe(SCRIPT.pain); // ได้ทั้งธุรกิจ+ขนาดทีมจากข้อความเดียว → ข้ามไปด่านปัญหา
    expect(textOf(out[2])).toBe(SCRIPT.decision);
    expect(textOf(out[3])).toBe(SCRIPT.timeline);
    expect(textOf(out[4])).toContain("ใช้ติดต่อเรื่องนี้เท่านั้น"); // แจ้งก่อนขอข้อมูลส่วนตัว
    expect(textOf(out[5])).toBe(EXTRA.contact);
    expect(out[6]).toMatchObject({ kind: "handoff", text: EXTRA.doneConsult });

    expect(state.savedLeads).toHaveLength(1);
    const lead = state.savedLeads[0];
    expect(lead).toMatchObject({
      name: "เอก",
      phone: "0812345678",
      leadType: "corporate",
      source: "messenger_ad",
      segment: "big",
    });
    expect(lead.consentAt).toBeTruthy();
    expect((lead.qualification as { fields: Record<string, string> }).fields).toMatchObject({
      team_size: "40 คน",
      decision_maker: "ตัดสินใจเองได้",
      timeline: "ภายใน 2 เดือน",
    });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const summary = notifyMock.mock.calls[0][0];
    expect(summary).toContain("ปุ่มที่กด: 100 ล้านขึ้นไป");
    expect(summary).toContain("โทร 0812345678");
    expect(summary).toContain("https://bot.example.test/admin/inbox/c1");
    expect((out[6] as { summary?: string }).summary).toBe(summary);
    expect(state.conversation.lead_draft).toEqual({});
  });

  it("กลุ่ม <10M ได้ราคาเริ่มต้นตามสคริปต์ในข้อความแรก แล้วถามขนาดทีมเมื่อได้ธุรกิจ+ปัญหาแล้ว", async () => {
    extractMock.mockResolvedValueOnce({
      fields: { business_type: "ร้านเสื้อผ้าออนไลน์", pain: "ตอบแชทลูกค้า" },
      intent: "answer",
      inputTokens: 5,
      outputTokens: 5,
      latencyMs: 1,
    });
    const out = await chat("ต่ำกว่า 10 ล้าน", "ร้านเสื้อผ้าออนไลน์ครับ อยากให้ช่วยตอบแชทลูกค้า");
    expect(textOf(out[0])).toContain("14,000 บาท");
    expect(textOf(out[1])).toBe(EXTRA.teamSize);
  });
});

describe("ลูกค้าตอบนอกเรื่อง", () => {
  it("ครั้งแรกถามซ้ำ · ครั้งที่สองติดกันส่งให้คน พร้อมสรุป", async () => {
    extractMock.mockResolvedValue({ fields: {}, intent: "off_topic", inputTokens: 5, outputTokens: 5, latencyMs: 1 });
    const out = await chat("10–100 ล้าน", "วันนี้อากาศร้อนมากเลย", "555 ฝนจะตกไหมนะ");
    expect(textOf(out[1])).toBe(`${EXTRA.offTopic}\n\n${EXTRA.businessType}`);
    expect(out[2]).toMatchObject({ kind: "handoff", text: EXTRA.toHuman });
    expect(state.savedLeads).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    extractMock.mockReset();
    extractMock.mockResolvedValue({ fields: {}, intent: "answer", inputTokens: 5, outputTokens: 5, latencyMs: 1 });
  });

  it("ลูกค้าถามกลับ → บอตไม่ตอบเอง จดคำถามไว้ให้คน แล้วถามต่อ", async () => {
    extractMock.mockResolvedValueOnce({ fields: {}, intent: "question", inputTokens: 5, outputTokens: 5, latencyMs: 1 });
    const out = await chat("100 ล้านขึ้นไป", "ทำระบบเชื่อม SAP ได้ไหมครับ");
    expect(textOf(out[1])).toBe(`${EXTRA.questionNoted}\n\n${EXTRA.businessType}`);
    expect((state.conversation.lead_draft as { questions: string[] }).questions).toEqual([
      "ทำระบบเชื่อม SAP ได้ไหมครับ",
    ]);
  });
});

describe("ขอคุยกับคน — ได้ทุกเมื่อ", () => {
  it("กลางโฟลว์ → โอนสาย + เก็บเท่าที่ได้ + แจ้งต้น", async () => {
    const out = await chat("100 ล้านขึ้นไป", "ธุรกิจโลจิสติกส์ 200 คน", "ขอคุยกับคนครับ");
    expect(out[2].kind).toBe("handoff");
    expect(state.savedLeads[0]).toMatchObject({ segment: "big" });
    expect((state.savedLeads[0].qualification as { reason: string }).reason).toBe("ลูกค้าขอคุยกับคน");
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("ระหว่างคนถือสาย บอตเงียบ แม้ลูกค้ากดปุ่มยอดขายซ้ำ", async () => {
    state.conversation.state = "awaiting_human";
    expect((await say("100 ล้านขึ้นไป")).kind).toBe("silent");
    state.conversation.state = "human_active";
    expect((await say("ต่ำกว่า 10 ล้าน")).kind).toBe("silent");
  });
});

describe("ถามราคา", () => {
  it("ครั้งแรก → ด่าน 5 ตามสคริปต์แล้วถามข้อเดิมต่อ · ถามซ้ำ → ส่งให้คน", async () => {
    const out = await chat("10–100 ล้าน", "ราคาเท่าไรครับ", "สรุปราคาเท่าไหร่ครับ");
    expect(textOf(out[1])).toBe(`${SCRIPT.price}\n\n${EXTRA.businessType}`);
    expect(out[2]).toMatchObject({ kind: "handoff", text: EXTRA.priceDetail });
    expect(extractMock).not.toHaveBeenCalled(); // ราคาจับด้วยโค้ด ไม่เสียค่าโมเดล
  });

  it("ถามราคาทำระบบ / ต่อรอง / ขอนัด → ส่งให้คนทันที (บอตไม่รับนัดเอง)", async () => {
    expect((await chat("100 ล้านขึ้นไป", "ทำระบบให้ทั้งระบบราคาเท่าไร"))[1]).toMatchObject({ kind: "handoff" });
    beforeEachReset();
    const neg = await chat("ต่ำกว่า 10 ล้าน", "แพงไปครับ ลดได้ไหม");
    expect(neg[1]).toMatchObject({ kind: "handoff" });
    expect(textOf(neg[1])).toContain(SCRIPT.expensive);
    beforeEachReset();
    const appt = await chat("100 ล้านขึ้นไป", "ขอนัดคุยวันพฤหัส 10 โมงได้ไหมครับ");
    expect(appt[1]).toMatchObject({ kind: "handoff", text: EXTRA.appointment });
    expect(textOf(appt[1])).not.toMatch(/พฤหัส|10 โมง/);
  });

  it("กลุ่มอยากเรียนเอง ถามราคา → ราคาจาก MASTER ของคอร์สที่แนะนำเท่านั้น", async () => {
    const out = await chat("อยากเรียน AI เอง", "อยากทำแชตบอทตอบลูกค้าใน LINE", "ราคาเท่าไรครับ");
    expect(textOf(out[1])).toContain("LINE ChatBot (4 ชม.)");
    expect(textOf(out[1])).toContain("ใช้ติดต่อเรื่องนี้เท่านั้น");
    expect(textOf(out[2])).toContain("LINE ChatBot: ออนไลน์ (Zoom) 4,500 บาท · ที่ออฟฟิศ 7,000 บาท");
  });
});

describe("ปฏิเสธให้เบอร์", () => {
  it("ไม่ตื๊อ · ไม่บันทึกช่องทางติดต่อ · ไม่ลงเวลายินยอม · ส่งให้คนตอบต่อในแชท", async () => {
    const out = await chat(
      "100 ล้านขึ้นไป",
      "บริษัทประกัน 80 คน",
      "งานตรวจเอกสารเคลม",
      "ต้องคุยกับผู้บริหารก่อน",
      "ไตรมาสหน้า",
      "ไม่สะดวกให้ข้อมูลครับ",
    );
    expect(out[5]).toMatchObject({ kind: "handoff", text: EXTRA.declinedContact });
    const lead = state.savedLeads[0];
    expect(lead).toMatchObject({ phone: null, email: null, lineId: null, name: null, consentAt: null });
    expect((lead.qualification as { fields: Record<string, string> }).fields.decision_maker).toBe(
      "ต้องคุยกับคนอื่นด้วย",
    );
  });

  it("ตอบช่องติดต่อผิดรูป → ถามซ้ำ 1 ครั้ง แล้วส่งให้คน", async () => {
    const d = {
      flow: "qualifier", segment: "self_learn", button: "อยากเรียน AI เอง", revenueBand: null,
      fields: { use_case: "เอกสาร", name: "มด" }, skipped: [], pending: "contact", retries: 0,
      offTopic: 0, priceAsked: 0, consentShown: true, consentAt: null, questions: [], recommended: ["01"],
    };
    state.conversation.state = "collecting_lead";
    state.conversation.lead_draft = d;
    const out = await chat("เดี๋ยวส่งให้นะ", "ยังไม่มีอะไรให้ครับ");
    expect(textOf(out[0])).toBe(EXTRA.contactRetry);
    expect(out[1].kind).toBe("handoff");
  });
});

describe("รั้วกันโมเดลแต่ง", () => {
  it("โมเดลยัดราคา/ตัวเลข/เบอร์ปลอมมา → ไม่หลุดถึงลูกค้า และไม่ถูกบันทึก", async () => {
    extractMock.mockResolvedValue({
      fields: {
        business_type: "ร้านกาแฟ แพ็กเกจ 9,900 บาท",
        team_size: "25 คน",
        pain: "ตอบแชท ลด 30% ภายใน 15 ธันวาคม",
        name: "สมชาย",
        // ช่องที่ไม่มีใน schema ต้องถูกทิ้ง
        reply: "ราคาพิเศษ 5,000 บาทครับ",
      } as unknown as Record<string, string>,
      intent: "answer",
      inputTokens: 5,
      outputTokens: 5,
      latencyMs: 1,
    });
    const out = await chat(
      "100 ล้านขึ้นไป",
      "ร้านกาแฟครับ",
      "12 คน",
      "ตอบแชทลูกค้า",
      "ตัดสินใจเอง",
      "เร็ว ๆ นี้",
      "ไม่สะดวกครับ",
    );
    expect(out[6].kind).toBe("handoff");

    const allowed = allowedMoneyFigures();
    for (const a of out) {
      for (const fact of extractRiskyFacts(textOf(a))) expect(allowed).toContain(fact);
      expect(textOf(a)).not.toMatch(/9,900|5,000|30%|15 ธันวาคม|สมชาย/);
    }
    const fields = (state.savedLeads[0].qualification as { fields: Record<string, string> }).fields;
    expect(JSON.stringify(fields)).not.toMatch(/9,900|25 คน|15 ธันวาคม|สมชาย|5,000/);
    expect(fields.business_type).toBe("ร้านกาแฟ"); // กลับไปใช้คำของลูกค้าเอง
    extractMock.mockReset();
    extractMock.mockResolvedValue({ fields: {}, intent: "answer", inputTokens: 5, outputTokens: 5, latencyMs: 1 });
  });

  it("โมเดลล้ม → ใช้กติกาตายตัวเดินต่อได้ ลูกค้าไม่ค้าง", async () => {
    extractMock.mockRejectedValueOnce(new Error("429 quota"));
    const out = await chat("100 ล้านขึ้นไป", "ธุรกิจรับเหมาก่อสร้าง ทีม 60 คน");
    expect(textOf(out[1])).toBe(SCRIPT.pain);
  });

  it("ถึงเพดานโมเดลของวัน → ไม่เรียกโมเดล แต่ยังเดินโฟลว์ได้", async () => {
    state.aiCallsToday = 9999;
    const out = await chat("100 ล้านขึ้นไป", "ธุรกิจคลินิกความงาม 15 คน");
    expect(extractMock).not.toHaveBeenCalled();
    expect(textOf(out[1])).toBe(SCRIPT.pain);
  });
});

function beforeEachReset() {
  state.conversation = {
    id: "c1",
    page_id: "P1",
    contact_id: "u1",
    state: "bot_active",
    lead_step: null,
    lead_draft: {},
    last_user_message_at: null,
  };
  state.savedLeads = [];
}
