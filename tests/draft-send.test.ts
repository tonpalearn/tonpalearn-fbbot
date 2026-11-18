import { describe, it, expect } from "vitest";
import { checkDraftSend, findPlaceholders } from "@/lib/draft-send";

const now = new Date("2026-11-18T10:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("findPlaceholders", () => {
  it("เจอ [ปัญหา] และ {ชื่อ}", () => {
    expect(findPlaceholders("เรื่อง [ปัญหา] ของคุณ {ชื่อ}")).toEqual(["[ปัญหา]", "{ชื่อ}"]);
  });
  it("ข้อความปกติไม่เจอ", () => {
    expect(findPlaceholders("สวัสดีครับ พรุ่งนี้ 10:00 สะดวกไหม")).toEqual([]);
  });
});

describe("checkDraftSend", () => {
  it("ห้ามส่งถ้ายังมีช่องให้เติม", () => {
    const r = checkDraftSend("เรื่อง [ปัญหา] ผมช่วยได้", ago(72), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("[ปัญหา]");
  });
  it("ข้อความว่างส่งไม่ได้", () => {
    expect(checkDraftSend("   ", ago(72), now).ok).toBe(false);
  });
  it("ภายใน 24 ชม. ส่งแบบธรรมดา", () => {
    expect(checkDraftSend("ทักอีกทีครับ", ago(5), now)).toEqual({ ok: true, useHumanAgentTag: false });
  });
  it("วันที่ 3–5 ต้องใช้ป้าย HUMAN_AGENT", () => {
    expect(checkDraftSend("ทักอีกทีครับ", ago(80), now)).toEqual({ ok: true, useHumanAgentTag: true });
  });
  it("เลย 7 วันส่งไม่ได้ (422)", () => {
    const r = checkDraftSend("ทักอีกทีครับ", ago(24 * 7 + 1), now);
    expect(r).toMatchObject({ ok: false, status: 422 });
  });
  it("ไม่รู้เวลาลูกค้าพิมพ์ล่าสุด → ส่งไม่ได้", () => {
    expect(checkDraftSend("ทักอีกทีครับ", null, now).ok).toBe(false);
  });
});
