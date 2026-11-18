/**
 * "งานวันนี้" หน้าแรกแอดมิน — ลำดับความสำคัญ · ไม่ซ้ำ · กำหนดส่งร่างรอบ 2 · ช่วงวันที่ไทย
 */
import { describe, it, expect } from "vitest";
import {
  buildTodayQueue,
  deadlineLevel,
  followupDeadline,
  thaiDateRange,
  type TodayConversation,
  type TodayLead,
} from "@/lib/today";

const NOW = new Date("2026-11-18T05:00:00.000Z"); // 12:00 เวลาไทย
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

function convo(p: Partial<TodayConversation> & { id: string }): TodayConversation {
  return {
    name: `ลูกค้า ${p.id}`,
    state: "bot_active",
    unread: false,
    lastUserMessageAt: hoursAgo(1),
    lastMessage: "ข้อความ",
    lastMessageSender: "bot",
    lastMessageAt: hoursAgo(1),
    hasDraft: false,
    ...p,
  };
}

function lead(p: Partial<TodayLead> & { id: string }): TodayLead {
  return {
    name: "คุณสมมติ",
    conversation_id: null,
    segment: "big",
    status: "new",
    phone: null,
    email: null,
    line_id: null,
    interest: null,
    qualification: null,
    created_at: hoursAgo(2),
    ...p,
  };
}

describe("followupDeadline / deadlineLevel", () => {
  it("กำหนดส่ง = 7 วันหลังข้อความล่าสุดของลูกค้า", () => {
    expect(followupDeadline("2026-11-10T03:00:00.000Z")?.toISOString()).toBe("2026-11-17T03:00:00.000Z");
    expect(followupDeadline(null)).toBeNull();
    expect(followupDeadline("ไม่ใช่วันที่")).toBeNull();
  });

  it("เหลือ ≤ 2 วัน = soon · เกิน = ok · เลย = expired", () => {
    expect(deadlineLevel(followupDeadline(daysAgo(6)), NOW)).toBe("soon"); // เหลือ 1 วัน
    expect(deadlineLevel(followupDeadline(daysAgo(5)), NOW)).toBe("soon"); // เหลือ 2 วันพอดี
    expect(deadlineLevel(followupDeadline(daysAgo(4.9)), NOW)).toBe("ok");
    expect(deadlineLevel(followupDeadline(daysAgo(7.1)), NOW)).toBe("expired");
    expect(deadlineLevel(null, NOW)).toBe("none");
  });
});

describe("buildTodayQueue", () => {
  it("รอคนขึ้นก่อน เรียงจากรอนานสุด · ห้องที่ต้นถือสายแต่ลูกค้าตอบมาก็นับ", () => {
    const q = buildTodayQueue({
      conversations: [
        convo({ id: "a", state: "awaiting_human", lastUserMessageAt: hoursAgo(1) }),
        convo({ id: "b", state: "awaiting_human", lastUserMessageAt: hoursAgo(5) }),
        convo({ id: "c", state: "human_active", lastMessageSender: "user", lastUserMessageAt: hoursAgo(3) }),
        convo({ id: "d", state: "human_active", lastMessageSender: "admin" }), // ต้นตอบไปแล้ว ไม่ต้องทำ
        convo({ id: "e", state: "bot_active" }),
      ],
      leads: [],
      now: NOW,
    });
    expect(q.waiting.map((i) => i.conversationId)).toEqual(["b", "c", "a"]);
    expect(q.waiting.find((i) => i.conversationId === "c")?.why).toBe("customer_replied");
  });

  it("ผู้สนใจใหม่ที่ห้องรอคนอยู่แล้ว ไม่ขึ้นซ้ำ แต่ติดไปกับแถวรอคน", () => {
    const l = lead({ id: "L1", conversation_id: "a", qualification: { button: "100 ล้านขึ้นไป" } });
    const q = buildTodayQueue({
      conversations: [convo({ id: "a", state: "awaiting_human" })],
      leads: [l, lead({ id: "L2", conversation_id: "z" }), lead({ id: "L3", status: "contacted" })],
      now: NOW,
    });
    expect(q.waiting[0].lead?.id).toBe("L1");
    expect(q.leads.map((i) => i.lead?.id)).toEqual(["L2"]); // L3 ติดต่อแล้ว ไม่ใช่งานวันนี้
  });

  it("ผู้สนใจใหม่ล่าสุดขึ้นก่อน · ไม่มีชื่อใช้ชื่อห้อง", () => {
    const q = buildTodayQueue({
      conversations: [convo({ id: "x", name: "ชื่อจากเมสเซนเจอร์" })],
      leads: [
        lead({ id: "old", created_at: hoursAgo(30) }),
        lead({ id: "new", created_at: hoursAgo(1), name: null, conversation_id: "x" }),
      ],
      now: NOW,
    });
    expect(q.leads.map((i) => i.lead?.id)).toEqual(["new", "old"]);
    expect(q.leads[0].name).toBe("ชื่อจากเมสเซนเจอร์");
  });

  it("ร่างรอบ 2 แยก ใกล้หมดเวลา / ยังมีเวลา / เลยกำหนด และไม่ซ้ำกับห้องที่ขึ้นแล้ว", () => {
    const q = buildTodayQueue({
      conversations: [
        convo({ id: "soon", hasDraft: true, lastUserMessageAt: daysAgo(6) }),
        convo({ id: "soon2", hasDraft: true, lastUserMessageAt: daysAgo(6.5) }),
        convo({ id: "later", hasDraft: true, lastUserMessageAt: daysAgo(3) }),
        convo({ id: "gone", hasDraft: true, lastUserMessageAt: daysAgo(8) }),
        convo({ id: "wait", hasDraft: true, state: "awaiting_human", lastUserMessageAt: daysAgo(6) }),
        convo({ id: "nodraft", lastUserMessageAt: daysAgo(6) }),
      ],
      leads: [],
      now: NOW,
    });
    expect(q.draftsSoon.map((i) => i.conversationId)).toEqual(["soon2", "soon"]);
    expect(q.draftsLater.map((i) => i.conversationId)).toEqual(["later"]);
    expect(q.draftsExpired).toBe(1);
    // ห้องที่รอคนอยู่ ไม่ขึ้นในหมวดร่าง แต่มีกำหนดส่งติดไปด้วย
    const w = q.waiting.find((i) => i.conversationId === "wait");
    expect(w?.deadlineLevel).toBe("soon");
    expect(q.draftsSoon.some((i) => i.conversationId === "wait")).toBe(false);
  });

  it("ไม่มีงานเลย = ว่างทุกหมวด", () => {
    const q = buildTodayQueue({ conversations: [convo({ id: "a" })], leads: [], now: NOW });
    expect(q).toEqual({ waiting: [], leads: [], draftsSoon: [], draftsLater: [], draftsExpired: 0 });
  });
});

describe("thaiDateRange", () => {
  it("วันไทย 00:00 → UTC ลบ 7 ชม. · ถึง = รวมทั้งวัน", () => {
    expect(thaiDateRange("2026-11-01", "2026-11-18")).toEqual({
      gte: "2026-10-31T17:00:00.000Z",
      lt: "2026-11-18T17:00:00.000Z",
    });
  });
  it("กรอกช่องเดียวได้ · ค่าผิดรูปแบบถูกทิ้ง · from > to สลับให้", () => {
    expect(thaiDateRange("2026-11-10", null)).toEqual({ gte: "2026-11-09T17:00:00.000Z", lt: null });
    expect(thaiDateRange("10/11/2026", "")).toEqual({ gte: null, lt: null });
    expect(thaiDateRange("2026-02-30", null)).toEqual({ gte: null, lt: null });
    expect(thaiDateRange("2026-11-18", "2026-11-01")).toEqual({
      gte: "2026-10-31T17:00:00.000Z",
      lt: "2026-11-18T17:00:00.000Z",
    });
  });
});
