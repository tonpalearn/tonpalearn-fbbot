/**
 * เทสต์สมองบอต — ปลอมชั้นฐานข้อมูลกับชั้นโมเดลทั้งหมด
 * เพื่อตรวจว่า "ลำดับการตัดสินใจ" ถูกต้องจริง ไม่ใช่แค่โค้ดรันผ่าน
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.ANTHROPIC_API_KEY = "test";
process.env.KB_SIMILARITY_THRESHOLD = "0.35";
process.env.DAILY_AI_CALL_CAP = "500";

// ── สถานะจำลองของฐานข้อมูล ───────────────────────────────────────────
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
  rules: [] as unknown[],
  faq: [] as { id: string; question: string; answer: string; score: number }[],
  kb: [] as { id: string; title: string; content: string; score: number }[],
  aiCallsToday: 0,
  botEnabled: true,
  savedLeads: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
};

vi.mock("@/lib/store", () => ({
  upsertContact: vi.fn(async () => "u1"),
  getOrCreateConversation: vi.fn(async () => state.conversation),
  saveMessage: vi.fn(async () => undefined),
  updateConversation: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    state.updates.push(patch);
    Object.assign(state.conversation, patch);
  }),
  getHistory: vi.fn(async () => []),
  isBotEnabled: vi.fn(async () => state.botEnabled),
  getActiveRules: vi.fn(async () => state.rules),
  searchFaq: vi.fn(async () => state.faq),
  searchKb: vi.fn(async () => state.kb),
  getSetting: vi.fn(async (_k: string, fallback: string) => fallback),
  saveLead: vi.fn(async (lead: Record<string, unknown>) => {
    state.savedLeads.push(lead);
  }),
  logHandoff: vi.fn(async () => undefined),
  logUsage: vi.fn(async () => undefined),
  countAiCallsToday: vi.fn(async () => state.aiCallsToday),
  bumpHit: vi.fn(async () => undefined),
}));

interface AiResult {
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const aiMock = vi.fn(
  async (): Promise<AiResult> => ({
    text: "คำตอบจากฐานความรู้ครับ",
    inputTokens: 10,
    outputTokens: 5,
    latencyMs: 100,
  }),
);
vi.mock("@/lib/ai", () => ({ answerFromKnowledge: (...a: unknown[]) => aiMock(...(a as [])) }));

const { handleIncoming } = await import("@/lib/brain");

const msg = (text: string, extra: Record<string, unknown> = {}) => ({
  pageId: "P1",
  psid: "u-psid",
  text,
  mid: `m${Math.random()}`,
  ...extra,
});

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
  state.rules = [];
  state.faq = [];
  state.kb = [];
  state.aiCallsToday = 0;
  state.botEnabled = true;
  state.savedLeads = [];
  state.updates = [];
  aiMock.mockClear();
});

describe("ชั้น 1 — คนกำลังคุยอยู่", () => {
  it("บอตต้องเงียบสนิทเมื่อสถานะเป็น human_active", async () => {
    state.conversation.state = "human_active";
    const out = await handleIncoming(msg("ราคาเท่าไรครับ"));
    expect(out.kind).toBe("silent");
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("บอตต้องเงียบระหว่างรอคนมารับสาย", async () => {
    state.conversation.state = "awaiting_human";
    expect((await handleIncoming(msg("ยังอยู่ไหมครับ"))).kind).toBe("silent");
  });

  it("แอดมินปิดบอตทั้งเพจ → เงียบ แม้จะมีกติกาที่ตรง", async () => {
    state.botEnabled = false;
    state.rules = [
      {
        id: "r1",
        name: "ทักทาย",
        match_type: "contains",
        pattern: "สวัสดี",
        action: "reply",
        reply_text: "สวัสดีครับ",
        quick_replies: null,
        priority: 10,
      },
    ];
    const out = await handleIncoming(msg("สวัสดีครับ"));
    expect(out.kind).toBe("silent");
  });
});

describe("ชั้น 2 — คำสั่งพิเศษมาก่อนทุกอย่าง", () => {
  it("ขอคุยกับคน → โอนสาย แม้จะมี FAQ ที่ตรงอยู่", async () => {
    state.faq = [{ id: "f1", question: "คุยกับคน", answer: "ตอบ FAQ", score: 0.9 }];
    const out = await handleIncoming(msg("ขอคุยกับคนหน่อยครับ"));
    expect(out.kind).toBe("handoff");
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("ขอเมนู → คืนปุ่มตัวเลือก และล้างสถานะเก็บข้อมูลที่ค้างอยู่", async () => {
    state.conversation.state = "collecting_lead";
    state.conversation.lead_step = "contact";
    const out = await handleIncoming(msg("เมนู"));
    expect(out.kind).toBe("quick_replies");
    expect(state.conversation.state).toBe("bot_active");
    expect(state.conversation.lead_step).toBeNull();
  });
});

describe("ชั้น 4 — กติกาคำสำคัญมาก่อน FAQ และ AI", () => {
  it("กติกาที่ตรงต้องชนะ FAQ ที่คะแนนสูงกว่า", async () => {
    state.rules = [
      {
        id: "r1",
        name: "ทักทาย",
        match_type: "contains",
        pattern: "สวัสดี",
        action: "reply",
        reply_text: "สวัสดีครับ",
        quick_replies: null,
        priority: 10,
      },
    ];
    state.faq = [{ id: "f1", question: "สวัสดี", answer: "ตอบจาก FAQ", score: 0.99 }];
    const out = await handleIncoming(msg("สวัสดีครับ"));
    expect(out).toMatchObject({ kind: "text", text: "สวัสดีครับ", source: "rule:ทักทาย" });
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("กติกาชนิด collect_lead ต้องเริ่มขั้นตอนถามข้อมูล", async () => {
    state.rules = [
      {
        id: "r2",
        name: "สนใจ",
        match_type: "contains",
        pattern: "สนใจ",
        action: "collect_lead",
        reply_text: null,
        quick_replies: null,
        priority: 20,
      },
    ];
    const out = await handleIncoming(msg("สนใจคอร์สครับ"));
    expect(out.kind).toBe("text");
    expect(state.conversation.state).toBe("collecting_lead");
    expect(state.conversation.lead_step).toBe("name");
  });
});

describe("ชั้น 5 — คำถามที่ถามบ่อย", () => {
  it("คะแนนถึงเกณฑ์ → ตอบจาก FAQ ตรง ๆ ไม่เรียกโมเดล", async () => {
    state.faq = [{ id: "f1", question: "ราคาเท่าไร", answer: "คอร์สละ 5,900 บาทครับ", score: 0.8 }];
    const out = await handleIncoming(msg("ราคาเท่าไรครับ"));
    expect(out).toMatchObject({ kind: "text", source: "faq" });
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("คำตอบที่ยังเป็น [กรอกเอง] ต้องไม่ถูกส่งให้ลูกค้า", async () => {
    state.faq = [
      { id: "f1", question: "ราคาเท่าไร", answer: "[กรอกเอง] ใส่ราคาจริง", score: 0.95 },
    ];
    const out = await handleIncoming(msg("ราคาเท่าไรครับ"));
    expect(out.kind).toBe("handoff"); // ไม่มีเนื้อหาอื่นให้ตอบ → โยนหาคน
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("คะแนนต่ำกว่าเกณฑ์ → ไม่ตอบจาก FAQ", async () => {
    state.faq = [{ id: "f1", question: "ราคาเท่าไร", answer: "5,900 บาท", score: 0.1 }];
    const out = await handleIncoming(msg("ที่จอดรถมีไหมครับ"));
    expect(out.kind).not.toBe("text");
  });
});

describe("ชั้น 6 — ฐานความรู้ + โมเดล", () => {
  it("มีเนื้อหาที่ค้นเจอ → เรียกโมเดลและตอบ", async () => {
    state.kb = [{ id: "k1", title: "เงื่อนไข", content: "เนื้อหายาว ๆ", score: 0.6 }];
    const out = await handleIncoming(msg("มีที่จอดรถไหมครับ"));
    expect(aiMock).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ kind: "text", source: "kb_ai" });
  });

  it("โมเดลบอกว่าตอบไม่ได้ → ต้องโยนหาคน ไม่ใช่ตอบมั่ว", async () => {
    state.kb = [{ id: "k1", title: "เงื่อนไข", content: "เนื้อหาไม่เกี่ยว", score: 0.6 }];
    aiMock.mockResolvedValueOnce({ text: null, inputTokens: 8, outputTokens: 2, latencyMs: 50 });
    const out = await handleIncoming(msg("ขอใบกำกับภาษีย้อนหลังได้ไหม"));
    expect(out.kind).toBe("handoff");
  });

  it("ถึงเพดานการใช้โมเดลของวันนี้ → ไม่เรียกโมเดลอีก แต่โยนหาคน", async () => {
    state.aiCallsToday = 500;
    state.kb = [{ id: "k1", title: "เงื่อนไข", content: "เนื้อหา", score: 0.9 }];
    const out = await handleIncoming(msg("ถามอะไรสักอย่าง"));
    expect(out.kind).toBe("handoff");
    expect(aiMock).not.toHaveBeenCalled();
  });

  it("ไม่มีเนื้อหาให้อ้างอิงเลย → ไม่เรียกโมเดล", async () => {
    const out = await handleIncoming(msg("เรื่องที่ไม่มีข้อมูลเลย"));
    expect(aiMock).not.toHaveBeenCalled();
    expect(out.kind).toBe("handoff");
  });
});

describe("ขั้นตอนเก็บข้อมูลผู้สนใจ", () => {
  it("เดินครบ 3 ขั้นแล้วบันทึก lead", async () => {
    state.conversation.state = "collecting_lead";
    state.conversation.lead_step = "name";

    const s1 = await handleIncoming(msg("ต้น ชัยวัฒน์"));
    expect(state.conversation.lead_step).toBe("contact");
    expect(s1.kind).toBe("text");

    await handleIncoming(msg("0812345678"));
    expect(state.conversation.lead_step).toBe("interest");

    const s3 = await handleIncoming(msg("อยากจัดอบรมในบริษัทครับ"));
    expect(state.savedLeads).toHaveLength(1);
    expect(state.savedLeads[0]).toMatchObject({
      name: "ต้น ชัยวัฒน์",
      phone: "0812345678",
      leadType: "corporate",
    });
    expect(state.conversation.state).toBe("bot_active");
    expect(s3.kind).toBe("text");
  });

  it("ให้เบอร์ไม่ถูกรูปแบบ → ถามซ้ำ ไม่เดินขั้นต่อไป", async () => {
    state.conversation.state = "collecting_lead";
    state.conversation.lead_step = "contact";
    const out = await handleIncoming(msg("ไม่มีเบอร์"));
    expect(out).toMatchObject({ source: "lead:retry_contact" });
    expect(state.conversation.lead_step).toBe("contact");
  });

  it("ลูกค้าปฏิเสธ → หยุดถามทันที ไม่บันทึกข้อมูล", async () => {
    state.conversation.state = "collecting_lead";
    state.conversation.lead_step = "contact";
    const out = await handleIncoming(msg("ไม่สะดวกให้ครับ"));
    expect(out).toMatchObject({ source: "lead:declined" });
    expect(state.savedLeads).toHaveLength(0);
    expect(state.conversation.state).toBe("bot_active");
  });

  it("บันทึกเวลาที่ลูกค้ายินยอมให้เก็บข้อมูล (PDPA)", async () => {
    state.rules = [
      {
        id: "r2",
        name: "สนใจ",
        match_type: "contains",
        pattern: "สนใจ",
        action: "collect_lead",
        reply_text: null,
        quick_replies: null,
        priority: 20,
      },
    ];
    await handleIncoming(msg("สนใจครับ"));
    expect(state.conversation.lead_draft.consent_at).toBeTruthy();
  });
});

describe("ปุ่มที่กด (postback)", () => {
  it("ปุ่มคุยกับทีมงาน → โอนสาย", async () => {
    const out = await handleIncoming(msg("", { postbackPayload: "MENU_HUMAN" }));
    expect(out.kind).toBe("handoff");
  });

  it("ปุ่มเริ่มต้น → ทักทายพร้อมเมนู", async () => {
    const out = await handleIncoming(msg("", { postbackPayload: "GET_STARTED" }));
    expect(out.kind).toBe("quick_replies");
  });

  it("ปุ่มจัดอบรมในองค์กร → เริ่มเก็บข้อมูลแบบองค์กร", async () => {
    await handleIncoming(msg("", { postbackPayload: "MENU_CORPORATE" }));
    expect(state.conversation.state).toBe("collecting_lead");
    expect(state.conversation.lead_draft.lead_type).toBe("corporate");
  });
});
