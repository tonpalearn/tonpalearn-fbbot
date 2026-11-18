/**
 * เทสต์ตรรกะล้วนของโฟลว์คัดลูกค้าจากแอด (ไม่แตะฐานข้อมูล/โมเดล)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SCRIPT,
  detectAdEntry,
  detectInterjection,
  deterministicExtract,
  extractContact,
  newDraft,
  nextField,
  questionFor,
  sanitizeExtracted,
  buildSummary,
} from "@/lib/qualifier";
import { COURSES, TIER_PRICES, recommendCourses } from "@/lib/courses";

describe("detectAdEntry — จับปุ่มยอดขายจากข้อมูลจริง 8–18 พ.ย.", () => {
  it.each([
    ["100 ล้านขึ้นไป", "big", "100M+"],
    ["10–100 ล้าน", "big", "10-100M"], // ขีดยาว (en dash) ตามที่ปุ่มส่งมาจริง
    ["10-100 ล้าน", "big", "10-100M"],
    ["ต่ำกว่า 10 ล้าน", "small", "<10M"],
    ["อยากเรียน AI เอง", "self_learn", null],
  ])("%s → %s", (text, segment, band) => {
    expect(detectAdEntry(text)).toMatchObject({ segment, revenueBand: band, button: text });
  });

  it("พิมพ์ยอดเอง '10 ล้าน' → กลุ่มหลัก · '5 ล้านครับ' → ต่ำกว่า 10 ล้าน", () => {
    expect(detectAdEntry("10 ล้าน")?.segment).toBe("big");
    expect(detectAdEntry("5 ล้านครับ")?.segment).toBe("small");
  });

  it("ข้อความขอรายละเอียดจริง (มีคำพิมพ์ผิด) → ด่าน 6", () => {
    const real = "ขอราบละเอียดบริการ และกรณีตัวอย่างต่าวๆที่ทำแล้วลูกค้าใช้งานได้จริง ได้ไหมครับ";
    expect(detectAdEntry(real)?.segment).toBe("details");
  });

  it("ข้อความทั่วไปไม่ถูกลากเข้าโฟลว์", () => {
    expect(detectAdEntry("สวัสดีครับ")).toBeNull();
    expect(detectAdEntry("ขอรายละเอียดคอร์ส AI Basic หน่อยครับ")).toBeNull();
    expect(detectAdEntry("ยอดขายตกลง 100 ล้านเลยปีนี้ ช่วยได้ไหม")).toBeNull();
  });
});

describe("ลำดับคำถาม + แจ้งก่อนขอข้อมูลส่วนตัว", () => {
  it("กลุ่มหลักถามครบ 7 ช่องตามลำดับ", () => {
    const d = newDraft({ segment: "big", button: "x", revenueBand: null }, "business_type");
    const order: string[] = [];
    for (let f = nextField(d); f; f = nextField(d)) {
      order.push(f);
      d.fields[f] = "ค่า";
    }
    expect(order).toEqual(["business_type", "team_size", "pain", "decision_maker", "timeline", "name", "contact"]);
  });

  it("ครั้งแรกที่ถามชื่อ/เบอร์ ต้องมีข้อความแจ้งว่าเก็บไว้ติดต่อเรื่องนี้เท่านั้น ขอลบได้", () => {
    const d = newDraft({ segment: "big", button: "x", revenueBand: null }, "name");
    const q = questionFor("name", d);
    expect(q.text).toMatch(/ใช้ติดต่อเรื่องนี้เท่านั้น/);
    expect(q.text).toMatch(/ลบ/);
    expect(q.consentShown).toBe(true);
    // แจ้งแล้วไม่ต้องแจ้งซ้ำ
    expect(questionFor("contact", { ...d, consentShown: true }).text).not.toMatch(/เท่านั้น/);
    // ถ้าข้ามชื่อไปถามเบอร์เลย ก็ต้องแจ้งก่อน
    expect(questionFor("contact", d).text).toMatch(/ใช้ติดต่อเรื่องนี้เท่านั้น/);
  });
});

describe("detectInterjection", () => {
  it.each([
    ["ราคาเท่าไรครับ", "business_type", "price"],
    ["ทำระบบให้ทั้งระบบราคาเท่าไร", "pain", "price_detail"],
    ["ขอใบเสนอราคาหน่อยครับ", "pain", "price_detail"],
    ["แพงไปครับ ลดได้ไหม", "timeline", "negotiate"],
    ["ขอนัดคุยวันพฤหัสได้ไหมครับ", "pain", "appointment"],
    ["ไม่สะดวกให้เบอร์ครับ", "contact", "decline"],
    ["ไม่สะดวกครับ", "name", "decline"],
    ["ขอคิดดูก่อนนะครับ", "timeline", "think_later"],
    ["มีทีม IT อยู่แล้วครับ", "pain", "has_it"],
  ])("%s → %s", (text, pending, kind) => {
    expect(detectInterjection(text, pending as never)).toBe(kind);
  });

  it("คำตอบธุรกิจยาว ๆ ที่มี 'ไม่ให้' ปน ต้องไม่ถูกนับเป็นการปฏิเสธ", () => {
    expect(detectInterjection("อยากให้ AI ช่วยไม่ให้ทีมต้องกรอกข้อมูลซ้ำทุกวัน", "pain")).toBeNull();
  });

  it("ตอบเรื่องตัดสินใจว่าต้องปรึกษาหุ้นส่วน ไม่ใช่ 'ขอคิดดู'", () => {
    expect(detectInterjection("ต้องปรึกษาหุ้นส่วนก่อนครับ", "decision_maker")).toBeNull();
  });
});

describe("สกัดค่าแบบไม่ใช้โมเดล", () => {
  it("คำถามแรกถาม 2 อย่าง → แยกธุรกิจกับขนาดทีม", () => {
    expect(deterministicExtract("โรงงานผลิตอาหารแช่แข็ง ทีมประมาณ 40 คนครับ", "business_type")).toEqual({
      team_size: "40 คน",
      business_type: "โรงงานผลิตอาหารแช่แข็ง",
    });
  });

  it("ช่องติดต่อ: เบอร์ / LINE / อีเมล", () => {
    expect(extractContact("081-234-5678")).toMatchObject({ phone: "0812345678" });
    expect(extractContact("ไลน์ไอดี: ton.pa")).toMatchObject({ line: "ton.pa" });
    expect(extractContact("@tonpa")).toMatchObject({ line: "@tonpa" });
    expect(extractContact("ton@example.com")).toMatchObject({ email: "ton@example.com" });
    expect(extractContact("ยังไม่สะดวกครับ")).toEqual({ phone: null, email: null, line: null });
  });
});

describe("sanitizeExtracted — ด่านกันโมเดลแต่ง", () => {
  it("ทิ้งค่าที่มีราคา/ตัวเลขที่ลูกค้าไม่ได้พิมพ์", () => {
    const out = sanitizeExtracted(
      { business_type: "ร้านกาแฟ งบ 50,000 บาท", team_size: "12 คน", pain: "ตอบแชทลูกค้า" },
      "ร้านกาแฟครับ อยากให้ช่วยตอบแชทลูกค้า",
    );
    expect(out).toEqual({ pain: "ตอบแชทลูกค้า" });
  });

  it("ไม่รับช่องติดต่อจากโมเดลเลย และชื่อต้องมาจากข้อความจริง", () => {
    expect(sanitizeExtracted({ contact: "0899999999", name: "สมชาย" }, "ผมชื่อเอกครับ")).toEqual({});
  });
});

describe("buildSummary", () => {
  it("มีปุ่มที่กด + ช่องที่เก็บได้ + ลิงก์แอดมิน", () => {
    const d = newDraft({ segment: "big", button: "100 ล้านขึ้นไป", revenueBand: "100M+" }, "pain");
    d.fields.business_type = "โรงสี";
    d.skipped.push("team_size");
    const s = buildSummary(d, "ได้ข้อมูลครบ", "https://x.test/admin/inbox/c1");
    expect(s).toContain("ปุ่มที่กด: 100 ล้านขึ้นไป");
    expect(s).toContain("ธุรกิจ: โรงสี");
    expect(s).toContain("ขนาดทีม: (ไม่ตอบ)");
    expect(s).toContain("https://x.test/admin/inbox/c1");
  });
});

describe("คอร์ส — ต้องตรงกับ MASTER ของต้น (ห้ามแต่งเอง)", () => {
  const masterPath = path.join(os.homedir(), "Documents/Claude/Projects/AI Course/MASTER.yaml");
  const hasMaster = fs.existsSync(masterPath);

  it.skipIf(!hasMaster)("รายชื่อ ชั่วโมง prereq tier และราคา ตรงกับ MASTER.yaml", () => {
    const y = fs.readFileSync(masterPath, "utf8");
    const blocks = y.split(/\n- id: '/).slice(1);
    const master = blocks
      .map((b) => ({
        id: b.slice(0, 2),
        name: b.match(/\n  name: (.+)/)?.[1].trim(),
        hours: Number(b.match(/\n  duration_hours: (\d+)/)?.[1]),
        prereq: b.match(/\n  prereq: '(\d*)'/)?.[1] ?? "",
        tier: b.match(/\n  pricing_tier: (\w+)/)?.[1],
      }))
      .filter((c) => c.name);
    expect(COURSES).toEqual(master);

    for (const tier of ["entry", "kids", "standard", "advanced"] as const) {
      const tiers = "\n" + y.split("\npricing_tiers:\n")[1].split("\ncourses:\n")[0];
      const sec = tiers.split(`\n  ${tier}:\n`)[1]?.split(/\n  \w+:\n/)[0] ?? "";
      const num = (k: string) => Number(sec.match(new RegExp(`\\n    ${k}: (\\d+)`))?.[1]);
      expect(TIER_PRICES[tier]).toEqual({ online: num("online"), onsite: num("onsite"), nextPerson: num("next_person") });
    }
  });

  it("สคริปต์ <10M และด่าน 5 ใช้ตัวเลข 14,000/22,000 ตามที่ต้นเขียน", () => {
    expect(SCRIPT.smallOpen).toContain("14,000 บาท");
    expect(SCRIPT.price).toContain("ครึ่งวัน 14,000 / เต็มวัน 22,000");
  });

  it("แนะนำคอร์สตามงาน และ 'ลูกค้า' ต้องไม่ถูกตีเป็นคอร์สเด็ก", () => {
    expect(recommendCourses("ทำแชตบอทตอบลูกค้าใน LINE").map((c) => c.id)).toEqual(["04"]);
    expect(recommendCourses("อยากทำเว็บขายของ").map((c) => c.id)).toEqual(["08"]);
    expect(recommendCourses("ยังไม่แน่ใจ").map((c) => c.id)).toEqual(["01", "02"]);
  });
});
