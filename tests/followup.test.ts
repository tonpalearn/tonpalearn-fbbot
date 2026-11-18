/**
 * ตามต่ออัตโนมัติ (BOT-VOICE 3.6) — กติกากรอบ 24 ชม. ของ Meta · ครั้งเดียว · ไม่ส่งหลังคนรับสาย
 * + เส้น cron ต้องมีรหัสลับ
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eligibility, inQuietHours, pickFollowup, type FollowupCandidate } from "@/lib/followup";
import { newDraft, slotButtons, TASK_BUTTONS, THINK_BUTTONS } from "@/lib/qualifier";

const { run } = vi.hoisted(() => ({
  run: vi.fn(async () => ({ checked: 0, sent: [], skipped: [], failed: [] })),
}));
vi.mock("@/lib/followup", async (orig) => ({ ...(await orig<object>()), runFollowups: () => run() }));

const H = 3600_000;
// พฤหัส 19 พ.ย. 2569 13:00 เวลาไทย
const NOW = new Date("2026-11-19T06:00:00Z");

function cand(over: Partial<FollowupCandidate> = {}, silentHours = 5): FollowupCandidate {
  const lastUser = new Date(NOW.getTime() - silentHours * H).toISOString();
  return {
    id: "c1",
    page_id: "P1",
    contact_id: "u1",
    state: "collecting_lead",
    lead_draft: newDraft({ segment: "big", button: "100 ล้านขึ้นไป", revenueBand: null }, "task") as unknown as Record<string, unknown>,
    last_user_message_at: lastUser,
    last_bot_message_at: new Date(new Date(lastUser).getTime() + 2000).toISOString(),
    followup_sent_at: null,
    ...over,
  };
}

describe("eligibility — ส่งได้เฉพาะในกรอบ 24 ชม. และครั้งเดียว", () => {
  it("เงียบ 5 ชม. ในเวลากลางวัน → ส่งได้", () => {
    expect(eligibility(cand(), NOW, false)).toEqual({ ok: true, why: "ส่งได้" });
  });
  it("เงียบ 25 ชม. (เลยกรอบ) → ไม่ส่ง", () => {
    expect(eligibility(cand({}, 25), NOW, false)).toMatchObject({ ok: false, why: "เลยกรอบ 24 ชม. ของ Meta" });
  });
  it("เงียบ 23 ชม. 45 นาที (เหลือไม่ถึงขอบเผื่อ 30 นาที) → ไม่ส่ง", () => {
    expect(eligibility(cand({}, 23.75), NOW, false).ok).toBe(false);
  });
  it("เงียบ 2 ชม. → ยังไม่ส่ง", () => {
    expect(eligibility(cand({}, 2), NOW, false)).toMatchObject({ ok: false, why: "ยังเงียบไม่ครบ" });
  });
  it("ส่งไปแล้ว → ไม่ส่งซ้ำ", () => {
    expect(eligibility(cand({ followup_sent_at: NOW.toISOString() }), NOW, false).ok).toBe(false);
  });
  it.each(["human_active", "awaiting_human", "bot_active"])("สถานะ %s → ไม่ส่ง", (st) => {
    expect(eligibility(cand({ state: st }), NOW, false).ok).toBe(false);
  });
  it("แอดมินพิมพ์ตอบหลังลูกค้า → ไม่ส่ง", () => {
    expect(eligibility(cand(), NOW, true)).toMatchObject({ ok: false, why: "คนตอบแล้ว" });
  });
  it("บอตยังไม่ได้ตอบข้อความล่าสุดของลูกค้า → ไม่ส่ง", () => {
    const c = cand();
    c.last_bot_message_at = new Date(new Date(c.last_user_message_at!).getTime() - 1000).toISOString();
    expect(eligibility(c, NOW, false).ok).toBe(false);
  });
  it("ไม่ใช่ห้องจากโฟลว์แอด → ไม่ส่ง", () => {
    expect(eligibility(cand({ lead_draft: { interest_seed: "x" } }), NOW, false).ok).toBe(false);
  });
  it("ช่วงห้ามส่ง 21:00–08:30 เวลาไทย", () => {
    expect(inQuietHours(new Date("2026-11-19T14:30:00Z"))).toBe(true); // 21:30
    expect(inQuietHours(new Date("2026-11-19T01:00:00Z"))).toBe(true); // 08:00
    expect(inQuietHours(new Date("2026-11-19T01:30:00Z"))).toBe(false); // 08:30
    expect(eligibility(cand({}, 5), new Date("2026-11-19T15:00:00Z"), false).ok).toBe(false);
  });
});

describe("pickFollowup — เลือก 1 ใน ก–ง ตามสิ่งที่ได้แล้ว", () => {
  const base = () => newDraft({ segment: "big", button: "x", revenueBand: null }, "task");
  it("ก. เงียบหลังคำถามแรก → ปุ่มงานชุดเดิม", () => {
    const f = pickFollowup(base(), []);
    expect(f.variant).toBe("ka_first");
    expect(f.parts[0].replies).toEqual(TASK_BUTTONS);
  });
  it("ข. รู้งานแล้ว ยังไม่เห็นเคส → ชวนพิมพ์ 'เล่าเลย' (ไม่ใส่คำลูกค้า)", () => {
    const d = base();
    d.fields.pain = "คำของลูกค้า xyz";
    const f = pickFollowup(d, []);
    expect(f.variant).toBe("kho_case");
    expect(f.parts[0].text).toContain("เล่าเลย");
    expect(f.parts[0].text).not.toContain("xyz");
  });
  it("ข2. ได้ข้อเสนอนัดแล้ว → ไม่ลอกข้อความชวนนัดเดิม", () => {
    const d = base();
    d.meetingOffered = true;
    expect(pickFollowup(d, []).parts[0].text).toContain("ถ้าสองเวลานั้นไม่สะดวก");
  });
  it("ข3. เห็นเคสแล้ว มีช่องเวลา → เสนอ 2 เวลา + ตั้งให้รอคำตอบเลือกเวลา", () => {
    const d = base();
    d.caseShown = true;
    const slots = ["ศุกร์ 20 พ.ย. 14:00", "อังคาร 24 พ.ย. 10:00"];
    const f = pickFollowup(d, slots);
    expect(f.variant).toBe("kho3_seen_case");
    expect(f.parts[0].replies).toEqual(slotButtons(slots));
    expect(f.patch).toMatchObject({ pending: "slot", offeredSlots: slots });
  });
  it("ค. เห็นราคาแล้ว → ปุ่มงบ/เวลา/ไม่แน่ใจ", () => {
    const d = base();
    d.priceShown = true;
    const f = pickFollowup(d, []);
    expect(f.variant).toBe("kha_price");
    expect(f.parts[0].replies).toEqual(THINK_BUTTONS);
  });
  it("ง. กลุ่มอยากเรียนเอง", () => {
    const d = newDraft({ segment: "self_learn", button: "x", revenueBand: null }, "use_case");
    expect(pickFollowup(d, []).variant).toBe("ngo_self");
  });
});

describe("/api/cron/followup — ต้องมีรหัสลับ", () => {

  beforeEach(() => run.mockClear());

  it("ไม่ตั้ง CRON_SECRET → 503 ไม่ทำงาน", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/followup/route");
    expect((await GET(new Request("http://x/api/cron/followup"))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it("รหัสผิด / ไม่มี header → 401", async () => {
    process.env.CRON_SECRET = "s".repeat(32);
    const { GET } = await import("@/app/api/cron/followup/route");
    expect((await GET(new Request("http://x", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await GET(new Request("http://x"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("รหัสถูก → ทำงาน", async () => {
    process.env.CRON_SECRET = "s".repeat(32);
    const { GET } = await import("@/app/api/cron/followup/route");
    const res = await GET(new Request("http://x", { headers: { authorization: `Bearer ${"s".repeat(32)}` } }));
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
