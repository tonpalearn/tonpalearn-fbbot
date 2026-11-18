/**
 * GET /api/admin/today — ต้องล็อกอิน · ประกอบคิวจากข้อมูลจริงของชั้นข้อมูล · พังแล้วตอบภาษาไทย
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { loggedIn: true, fail: false };

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () =>
    state.loggedIn ? null : Response.json({ error: "ยังไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
  ),
}));

vi.mock("@/app/api/admin/_lib/data", () => ({
  listConversations: vi.fn(async () => {
    if (state.fail) throw new Error("db down");
    return [
      {
        id: "c1",
        name: "ลูกค้า ก",
        state: "awaiting_human",
        unread: true,
        lastUserMessageAt: new Date(Date.now() - 3600_000).toISOString(),
        lastMessage: "สวัสดี",
        lastMessageSender: "user",
        lastMessageAt: new Date().toISOString(),
        hasDraft: false,
      },
    ];
  }),
  listNewLeads: vi.fn(async () => [
    {
      id: "L1",
      name: "คุณ ข",
      conversation_id: null,
      segment: "small",
      status: "new",
      phone: null,
      email: null,
      line_id: null,
      interest: null,
      qualification: null,
      created_at: new Date().toISOString(),
    },
  ]),
  getBotStatus: vi.fn(async () => ({
    botEnabled: true,
    pageRegistered: true,
    lastBotReplyAt: null,
    lastCustomerMessageAt: null,
    webhookErrors24h: 0,
    messagesToday: 3,
    aiCallsToday: 1,
    aiCallCap: 500,
  })),
}));

const { GET } = await import("@/app/api/admin/today/route");

beforeEach(() => {
  state.loggedIn = true;
  state.fail = false;
});

describe("GET /api/admin/today", () => {
  it("ไม่ล็อกอิน = 401", async () => {
    state.loggedIn = false;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("คืนคิว 3 หมวด + สถานะบอต", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waiting.map((i: { conversationId: string }) => i.conversationId)).toEqual(["c1"]);
    expect(body.leads.map((i: { lead: { id: string } }) => i.lead.id)).toEqual(["L1"]);
    expect(body.draftsSoon).toEqual([]);
    expect(body.status.messagesToday).toBe(3);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("ฐานข้อมูลพัง = 500 พร้อมข้อความไทย", async () => {
    state.fail = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("ดึงงานวันนี้ไม่สำเร็จ");
  });
});
