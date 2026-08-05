/**
 * เทสต์ปลายทางที่ Facebook ยิงเข้ามา
 * ปลอมทุกอย่างที่ออกนอกเครื่อง (ฐานข้อมูล, Facebook API, โมเดล)
 * แล้วตรวจว่า "กติกาการรับ event" ถูกต้องจริง
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

const SECRET = "webhook-test-secret";
process.env.FB_APP_SECRET = SECRET;
process.env.FB_VERIFY_TOKEN = "verify-me";
process.env.FB_PAGE_ID = "PAGE1";
process.env.FB_PAGE_ACCESS_TOKEN = "token";

// ── after(): ให้รันงานเบื้องหลังทันที จะได้ตรวจผลได้ ─────────────────
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void> | void) => {
    pending.push(Promise.resolve().then(fn));
  },
}));
const pending: Promise<unknown>[] = [];

// ── ปลอมการส่งข้อความออกไปหา Facebook ────────────────────────────────
const sent = { text: [] as string[], quickReplies: 0, actions: [] as string[], passed: 0 };
vi.mock("@/lib/facebook", async () => {
  const actual = await vi.importActual<typeof import("@/lib/facebook")>("@/lib/facebook");
  return {
    ...actual,
    sendText: vi.fn(async (_psid: string, text: string) => {
      sent.text.push(text);
    }),
    sendQuickReplies: vi.fn(async () => {
      sent.quickReplies += 1;
    }),
    sendSenderAction: vi.fn(async (_psid: string, action: string) => {
      sent.actions.push(action);
    }),
    passThreadControl: vi.fn(async () => {
      sent.passed += 1;
    }),
  };
});

// ── ปลอมฐานข้อมูล ───────────────────────────────────────────────────
const seenKeys = new Set<string>();
const store = {
  claimed: [] as string[],
  handoffs: 0,
  savedMessages: [] as Record<string, unknown>[],
};
vi.mock("@/lib/store", () => ({
  claimEvent: vi.fn(async (key: string) => {
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    store.claimed.push(key);
    return true;
  }),
  markEventDone: vi.fn(async () => undefined),
  upsertContact: vi.fn(async () => "contact-1"),
  getOrCreateConversation: vi.fn(async () => ({
    id: "conv-1",
    page_id: "PAGE1",
    contact_id: "contact-1",
    state: "bot_active",
    lead_step: null,
    lead_draft: {},
    last_user_message_at: null,
  })),
  saveMessage: vi.fn(async (m: Record<string, unknown>) => {
    store.savedMessages.push(m);
  }),
  updateConversation: vi.fn(async () => undefined),
  logHandoff: vi.fn(async () => {
    store.handoffs += 1;
  }),
}));

// ── ปลอมสมองบอต: ตอบข้อความธรรมดาเสมอ ────────────────────────────────
const brainMock = vi.fn(async () => ({
  kind: "text" as const,
  text: "ตอบจากบอตครับ",
  source: "faq",
  confidence: 0.9,
}));
vi.mock("@/lib/brain", () => ({ handleIncoming: (...a: unknown[]) => brainMock(...(a as [])) }));

const { GET, POST } = await import("@/app/api/webhook/facebook/route");

function sign(body: string, secret = SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function post(payload: unknown, opts: { badSignature?: boolean } = {}): Promise<Response> {
  const raw = JSON.stringify(payload);
  return POST(
    new Request("http://localhost/api/webhook/facebook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": opts.badSignature ? sign(raw, "wrong") : sign(raw),
      },
      body: raw,
    }),
  );
}

async function settle(): Promise<void> {
  await Promise.all(pending.splice(0));
}

const textEvent = (text: string, mid: string) => ({
  object: "page",
  entry: [
    {
      id: "PAGE1",
      messaging: [
        {
          sender: { id: "USER1" },
          recipient: { id: "PAGE1" },
          timestamp: 1700000000000,
          message: { mid, text },
        },
      ],
    },
  ],
});

beforeEach(() => {
  seenKeys.clear();
  store.claimed = [];
  store.handoffs = 0;
  store.savedMessages = [];
  sent.text = [];
  sent.quickReplies = 0;
  sent.actions = [];
  sent.passed = 0;
  brainMock.mockClear();
});

describe("GET — ยืนยัน webhook", () => {
  it("token ถูก → คืน challenge", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/webhook/facebook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=xyz",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("xyz");
  });

  it("token ผิด → 403", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/webhook/facebook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=xyz",
      ),
    );
    expect(res.status).toBe(403);
  });

  it("ไม่มี hub.mode → 403", async () => {
    const res = await GET(new Request("http://localhost/api/webhook/facebook"));
    expect(res.status).toBe(403);
  });
});

describe("POST — ลายเซ็น", () => {
  it("ลายเซ็นผิด → 401 และห้ามประมวลผล", async () => {
    const res = await post(textEvent("สวัสดี", "m1"), { badSignature: true });
    expect(res.status).toBe(401);
    await settle();
    expect(brainMock).not.toHaveBeenCalled();
  });

  it("ลายเซ็นถูก → 200 แล้วค่อยประมวลผลเบื้องหลัง", async () => {
    const res = await post(textEvent("สวัสดี", "m1"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EVENT_RECEIVED");
    // ตอนคืน 200 งานยังไม่ต้องเสร็จ — นี่คือหัวใจของการไม่ให้ Facebook ยิงซ้ำ
    await settle();
    expect(brainMock).toHaveBeenCalledOnce();
    expect(sent.text).toEqual(["ตอบจากบอตครับ"]);
  });

  it("body ไม่ใช่ JSON → ยังคืน 200 (กัน Facebook ยิงซ้ำไม่รู้จบ)", async () => {
    const raw = "ไม่ใช่ json";
    const res = await POST(
      new Request("http://localhost/api/webhook/facebook", {
        method: "POST",
        headers: { "X-Hub-Signature-256": sign(raw) },
        body: raw,
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST — กันประมวลผลซ้ำ", () => {
  it("event เดิม (mid เดิม) ส่งมาสองครั้ง → ตอบลูกค้าครั้งเดียว", async () => {
    await post(textEvent("ราคาเท่าไร", "same-mid"));
    await settle();
    await post(textEvent("ราคาเท่าไร", "same-mid"));
    await settle();

    expect(store.claimed).toHaveLength(1);
    expect(brainMock).toHaveBeenCalledOnce();
    expect(sent.text).toHaveLength(1);
  });

  it("mid ต่างกัน → ประมวลผลทั้งสองครั้ง", async () => {
    await post(textEvent("ถามข้อ 1", "mid-1"));
    await settle();
    await post(textEvent("ถามข้อ 2", "mid-2"));
    await settle();
    expect(brainMock).toHaveBeenCalledTimes(2);
  });
});

describe("POST — เหตุการณ์ที่ไม่ใช่ข้อความธรรมดา", () => {
  it("เสียงสะท้อนจากข้อความที่เพจส่งเอง (echo) → ไม่ตอบ", async () => {
    await post({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          messaging: [
            {
              sender: { id: "PAGE1" },
              recipient: { id: "USER1" },
              message: { mid: "echo-1", text: "ข้อความจากเพจ", is_echo: true },
            },
          ],
        },
      ],
    });
    await settle();
    expect(brainMock).not.toHaveBeenCalled();
    expect(sent.text).toHaveLength(0);
  });

  it("ส่งรูปมาโดยไม่มีข้อความ → ตอบรับว่าได้รับแล้ว ไม่เรียกสมองบอต", async () => {
    await post({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          messaging: [
            {
              sender: { id: "USER1" },
              message: { mid: "img-1", attachments: [{ type: "image" }] },
            },
          ],
        },
      ],
    });
    await settle();
    expect(brainMock).not.toHaveBeenCalled();
    expect(sent.text[0]).toContain("ได้รับไฟล์แล้ว");
  });

  it("object ไม่ใช่ page → ไม่ทำอะไร", async () => {
    const res = await post({ object: "instagram", entry: [] });
    expect(res.status).toBe(200);
    await settle();
    expect(brainMock).not.toHaveBeenCalled();
  });

  it("Facebook คืนสายกลับมาให้บอต → ไม่ตอบข้อความ แต่บันทึกการคืนสาย", async () => {
    await post({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          messaging: [
            {
              sender: { id: "USER1" },
              pass_thread_control: { new_owner_app_id: "1234", metadata: "คืนสาย" },
            },
          ],
        },
      ],
    });
    await settle();
    expect(brainMock).not.toHaveBeenCalled();
    expect(store.handoffs).toBe(1);
  });
});

describe("POST — ผลลัพธ์จากสมองบอต", () => {
  it("สั่งเงียบ → ไม่ส่งอะไรออกไปเลย", async () => {
    brainMock.mockResolvedValueOnce({
      kind: "silent",
      reason: "คนกำลังคุย",
    } as unknown as Awaited<ReturnType<typeof brainMock>>);
    await post(textEvent("ยังอยู่ไหม", "silent-1"));
    await settle();
    expect(sent.text).toHaveLength(0);
  });

  it("สั่งโอนหาคน → ส่งข้อความแจ้ง แล้วโอนสายจริง", async () => {
    brainMock.mockResolvedValueOnce({
      kind: "handoff",
      text: "กำลังเรียกทีมงานครับ",
      reason: "ลูกค้าขอ",
    } as unknown as Awaited<ReturnType<typeof brainMock>>);
    await post(textEvent("ขอคุยกับคน", "handoff-1"));
    await settle();
    expect(sent.text).toEqual(["กำลังเรียกทีมงานครับ"]);
    expect(sent.passed).toBe(1);
    expect(store.handoffs).toBe(1);
  });

  it("บอกลูกค้าว่าอ่านแล้วและกำลังพิมพ์ ก่อนตอบ", async () => {
    await post(textEvent("สวัสดี", "typing-1"));
    await settle();
    expect(sent.actions).toEqual(["mark_seen", "typing_on"]);
  });
});
