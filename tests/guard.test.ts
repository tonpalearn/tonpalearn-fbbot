/**
 * เทสต์ตาข่ายรับคำตอบของโมเดล + การจัดรูปประวัติแชท
 * สองอย่างนี้คือจุดที่ "บอตพูดผิด" กับ "บอตเงียบใส่ลูกค้า" เคยเล็ดลอดออกไป
 */
import { describe, it, expect } from "vitest";
import { extractRiskyFacts, findUnsupportedFacts } from "@/lib/guard";
import { normalizeHistory, startOfThaiDay } from "@/lib/store";

describe("extractRiskyFacts — ดึงตัวเลขที่เสี่ยง", () => {
  it("จับจำนวนเงินหลายรูปแบบ", () => {
    expect(extractRiskyFacts("ราคา 5,900 บาทครับ")).toContain("5900");
    expect(extractRiskyFacts("฿12,000 ต่อคน")).toContain("12000");
    expect(extractRiskyFacts("ค่าอบรม 3500 บาท")).toContain("3500");
  });

  it("จับวันที่ภาษาไทย", () => {
    expect(extractRiskyFacts("อบรมวันที่ 15 สิงหาคม นี้ครับ")).toContain("15สิงหาคม");
    expect(extractRiskyFacts("รอบ 22 ส.ค.")).toContain("22ส.ค.");
  });

  it("จับเวลา", () => {
    expect(extractRiskyFacts("เริ่ม 09:00 น.")).toEqual(expect.arrayContaining(["09:00น."]));
  });

  it("ข้อความที่ไม่มีตัวเลขเสี่ยง คืนรายการว่าง", () => {
    expect(extractRiskyFacts("คอร์สนี้เหมาะกับคนทำงานทุกสายครับ")).toEqual([]);
  });

  it("ตัวเลขลอย ๆ ที่ไม่ผูกกับเงินหรือวัน ไม่ถือว่าเสี่ยง", () => {
    expect(extractRiskyFacts("มีทั้งหมด 8 บทเรียนครับ")).toEqual([]);
  });
});

describe("findUnsupportedFacts — กันโมเดลแต่งราคาเอง", () => {
  const passages = ["คอร์ส OPB Builder ราคา 7,900 บาท อบรมวันที่ 15 สิงหาคม เวลา 09:00 น."];

  it("ตัวเลขที่มีในเนื้อหาอ้างอิง → ผ่าน", () => {
    expect(findUnsupportedFacts("ราคา 7,900 บาทครับ", passages)).toEqual([]);
  });

  it("เขียนตัวเลขคนละรูปแบบแต่ค่าเดียวกัน → ยังผ่าน", () => {
    expect(findUnsupportedFacts("ราคา 7900 บาทครับ", passages)).toEqual([]);
  });

  it("โมเดลแต่งราคาที่ไม่มีในเนื้อหา → ต้องจับได้", () => {
    expect(findUnsupportedFacts("ราคา 5,500 บาทครับ", passages)).toContain("5500");
  });

  it("โมเดลแต่งวันอบรมที่ไม่มีในเนื้อหา → ต้องจับได้", () => {
    expect(findUnsupportedFacts("อบรมวันที่ 20 กันยายน ครับ", passages)).toContain("20กันยายน");
  });

  it("คำตอบที่ไม่มีตัวเลขเลย → ผ่านเสมอ", () => {
    expect(findUnsupportedFacts("คอร์สนี้เหมาะกับคนทำงานครับ", passages)).toEqual([]);
  });

  it("ไม่มีเนื้อหาอ้างอิงเลย แต่คำตอบมีราคา → ต้องจับได้", () => {
    expect(findUnsupportedFacts("ราคา 1,000 บาท", [])).toContain("1000");
  });
});

describe("normalizeHistory — จัดประวัติให้ API รับได้", () => {
  it("ทิ้งข้อความว่าง", () => {
    const out = normalizeHistory([
      { role: "user", content: "สวัสดี" },
      { role: "assistant", content: "   " },
      { role: "user", content: "ถามหน่อย" },
    ]);
    expect(out).toEqual([{ role: "user", content: "สวัสดี\nถามหน่อย" }]);
  });

  it("ยุบข้อความฝั่งเดียวกันที่ติดกัน", () => {
    const out = normalizeHistory([
      { role: "user", content: "สวัสดีครับ" },
      { role: "user", content: "อยากถามเรื่องคอร์ส" },
      { role: "assistant", content: "ได้เลยครับ" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "user", content: "สวัสดีครับ\nอยากถามเรื่องคอร์ส" });
  });

  it("ตัดหัวทิ้งจนกว่าตัวแรกจะเป็นฝั่งผู้ใช้", () => {
    const out = normalizeHistory([
      { role: "assistant", content: "ข้อความบอตที่ค้างจากรอบก่อน" },
      { role: "user", content: "ถามต่อ" },
    ]);
    expect(out[0].role).toBe("user");
    expect(out).toHaveLength(1);
  });

  it("ประวัติที่มีแต่ข้อความบอต → คืนรายการว่าง (ไม่ส่งอะไรที่ API ปฏิเสธ)", () => {
    expect(normalizeHistory([{ role: "assistant", content: "สวัสดีครับ" }])).toEqual([]);
  });

  it("ประวัติที่ถูกต้องอยู่แล้ว → ไม่เปลี่ยน", () => {
    const input = [
      { role: "user" as const, content: "ถาม" },
      { role: "assistant" as const, content: "ตอบ" },
      { role: "user" as const, content: "ถามอีก" },
    ];
    expect(normalizeHistory(input)).toEqual(input);
  });
});

describe("startOfThaiDay — โควตารีเซ็ตเที่ยงคืนเวลาไทย", () => {
  it("บ่ายสองของไทย → ได้เที่ยงคืนวันเดียวกันตามเวลาไทย (17:00Z ของเมื่อวาน)", () => {
    // 2026-08-05 14:00 เวลาไทย = 2026-08-05T07:00:00Z
    const result = startOfThaiDay(new Date("2026-08-05T07:00:00Z"));
    expect(result.toISOString()).toBe("2026-08-04T17:00:00.000Z");
  });

  it("ตีหนึ่งของไทย (ซึ่งยังเป็นเมื่อวานใน UTC) → ยังนับเป็นวันใหม่ของไทย", () => {
    // 2026-08-06 01:00 เวลาไทย = 2026-08-05T18:00:00Z
    const result = startOfThaiDay(new Date("2026-08-05T18:00:00Z"));
    expect(result.toISOString()).toBe("2026-08-05T17:00:00.000Z");
  });
});
