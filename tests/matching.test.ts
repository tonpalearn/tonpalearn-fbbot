import { describe, it, expect } from "vitest";
import {
  detectSpecialCommand,
  extractEmail,
  extractPhone,
  isDecline,
  looksCorporate,
  matchRule,
  normalize,
  type Rule,
} from "@/lib/matching";

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1",
  name: "ทดสอบ",
  match_type: "contains",
  pattern: "ราคา",
  action: "reply",
  reply_text: "ตอบ",
  quick_replies: null,
  priority: 100,
  ...over,
});

describe("normalize", () => {
  it("ตัดช่องว่างซ้ำและอักขระล่องหน", () => {
    expect(normalize("  สวัสดี   ครับ ")).toBe("สวัสดี ครับ");
    expect(normalize("ราคา​เท่าไร")).toBe("ราคาเท่าไร");
  });
});

describe("detectSpecialCommand", () => {
  it("จับคำขอคุยกับคน", () => {
    expect(detectSpecialCommand("ขอคุยกับคนหน่อยครับ")).toBe("handoff");
    expect(detectSpecialCommand("เรียกแอดมินที")).toBe("handoff");
  });
  it("จับคำขอเมนู", () => {
    expect(detectSpecialCommand("เมนู")).toBe("menu");
  });
  it("คำสั่งหยุดบอตมาก่อนคำอื่น", () => {
    expect(detectSpecialCommand("หยุดบอต")).toBe("stop_bot");
  });
  it("ข้อความทั่วไปไม่ใช่คำสั่งพิเศษ", () => {
    expect(detectSpecialCommand("คอร์สนี้ราคาเท่าไรครับ")).toBeNull();
  });
});

describe("matchRule", () => {
  it("เลือกกติกาที่ priority น้อยกว่าเป็นอันดับแรก", () => {
    const hit = matchRule("อยากรู้ราคาครับ", [
      rule({ id: "a", pattern: "ราคา", priority: 50, name: "ราคา" }),
      rule({ id: "b", pattern: "อยากรู้", priority: 10, name: "อยากรู้" }),
    ]);
    expect(hit?.id).toBe("b");
  });

  it("exact ต้องตรงทั้งข้อความ", () => {
    const rules = [rule({ match_type: "exact", pattern: "ราคา" })];
    expect(matchRule("ราคา", rules)?.id).toBe("r1");
    expect(matchRule("ราคาเท่าไร", rules)).toBeNull();
  });

  it("regex ที่เขียนผิดต้องไม่ทำให้ระบบล้ม", () => {
    const rules = [
      rule({ id: "bad", match_type: "regex", pattern: "([unclosed", priority: 1 }),
      rule({ id: "good", pattern: "ราคา", priority: 2 }),
    ];
    expect(matchRule("ราคาเท่าไร", rules)?.id).toBe("good");
  });

  it("ไม่ตรงเลยคืน null", () => {
    expect(matchRule("สวัสดีครับ", [rule({})])).toBeNull();
  });
});

describe("extractPhone", () => {
  it.each([
    ["0812345678", "0812345678"],
    ["081-234-5678", "0812345678"],
    ["เบอร์ 081 234 5678 ครับ", "0812345678"],
    ["+66812345678", "0812345678"],
  ])("อ่าน %s ได้เป็น %s", (input, expected) => {
    expect(extractPhone(input)).toBe(expected);
  });

  it("ข้อความที่ไม่มีเบอร์คืน null", () => {
    expect(extractPhone("ยังไม่สะดวกให้ครับ")).toBeNull();
  });
});

describe("extractEmail", () => {
  it("อ่านอีเมลออก", () => {
    expect(extractEmail("ส่งมาที่ ton@tonpalearn.com นะครับ")).toBe("ton@tonpalearn.com");
  });
});

describe("isDecline", () => {
  it("จับคำปฏิเสธ", () => {
    expect(isDecline("ไม่สะดวกครับ")).toBe(true);
    expect(isDecline("0812345678")).toBe(false);
  });
});

describe("looksCorporate", () => {
  it("แยกงานองค์กรออกจากรายบุคคล", () => {
    expect(looksCorporate("อยากจัดอบรมในบริษัทครับ")).toBe(true);
    expect(looksCorporate("อยากเรียนเองครับ")).toBe(false);
  });
});
