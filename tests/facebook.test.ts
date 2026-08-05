import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

const SECRET = "test-app-secret";

beforeAll(() => {
  process.env.FB_APP_SECRET = SECRET;
  process.env.FB_PAGE_ID = "1234567890";
  process.env.FB_PAGE_ACCESS_TOKEN = "token";
  process.env.FB_VERIFY_TOKEN = "verify";
});

const { verifySignature, splitForMessenger } = await import("@/lib/facebook");

function sign(body: string, secret = SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifySignature", () => {
  const body = JSON.stringify({ object: "page", entry: [{ id: "1" }] });

  it("ผ่านเมื่อลายเซ็นถูก", () => {
    expect(verifySignature(body, sign(body))).toBe(true);
  });

  it("ไม่ผ่านเมื่อ body ถูกแก้แม้แต่ตัวเดียว", () => {
    expect(verifySignature(body + " ", sign(body))).toBe(false);
  });

  it("ไม่ผ่านเมื่อใช้ความลับผิด", () => {
    expect(verifySignature(body, sign(body, "wrong-secret"))).toBe(false);
  });

  it("ไม่ผ่านเมื่อไม่มี header", () => {
    expect(verifySignature(body, null)).toBe(false);
  });

  it("ไม่ผ่านเมื่ออัลกอริทึมไม่ใช่ sha256", () => {
    const sha1 = "sha1=" + crypto.createHmac("sha1", SECRET).update(body).digest("hex");
    expect(verifySignature(body, sha1)).toBe(false);
  });

  it("ไม่ผ่านเมื่อ header เพี้ยน", () => {
    expect(verifySignature(body, "ไม่ใช่ลายเซ็น")).toBe(false);
  });
});

describe("splitForMessenger", () => {
  it("ข้อความสั้นไม่ถูกตัด", () => {
    expect(splitForMessenger("สวัสดีครับ")).toEqual(["สวัสดีครับ"]);
  });

  it("ข้อความยาวถูกตัดเป็นหลายชิ้น ชิ้นละไม่เกินลิมิต", () => {
    const long = "ก".repeat(2500) + " จบ";
    const parts = splitForMessenger(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
  });

  it("พยายามตัดที่ช่องว่างแทนกลางคำ", () => {
    const text = "คำแรก ".repeat(50);
    const parts = splitForMessenger(text, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
  });
});
