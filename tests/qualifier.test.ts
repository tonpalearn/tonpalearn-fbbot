/**
 * เทสต์ตรรกะล้วนของโฟลว์คัดลูกค้าจากแอด (ไม่แตะฐานข้อมูล/โมเดล)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CASES,
  FREE_CALL_LINE,
  SCRIPT,
  TASK_BUTTONS,
  TASK_BUTTONS_SMALL,
  USECASE_BUTTONS,
  VOICE,
  buildSummary,
  detectAdEntry,
  detectInterjection,
  extractContact,
  inviteParts,
  isBotQuestion,
  isLikelyName,
  newDraft,
  openingParts,
  pickCase,
  priceText,
  roundTwoDraft,
  sanitizeExtracted,
  usableSlots,
  workflowParts,
} from "@/lib/qualifier";
import { COURSES, TIER_PRICES, coursePriceLine, courseLine, courseById, recommendCourses } from "@/lib/courses";
import * as Q from "@/lib/qualifier";

describe("detectAdEntry — ปุ่มยอดขายจริง", () => {
  it.each([
    ["100 ล้านขึ้นไป", "big", "100M+"],
    ["10–100 ล้าน", "big", "10-100M"],
    ["10-100 ล้าน", "big", "10-100M"],
    ["ต่ำกว่า 10 ล้าน", "small", "<10M"],
    ["อยากเรียน AI เอง", "self_learn", null],
  ])("%s → %s", (text, segment, band) => {
    expect(detectAdEntry(text)).toMatchObject({ segment, revenueBand: band, button: text });
  });

  it("พิมพ์ยอดเอง + ข้อความขอรายละเอียดจริง (มีคำพิมพ์ผิด)", () => {
    expect(detectAdEntry("10 ล้าน")?.segment).toBe("big");
    expect(detectAdEntry("5 ล้านครับ")?.segment).toBe("small");
    expect(detectAdEntry("ขอราบละเอียดบริการ และกรณีตัวอย่างต่าวๆที่ทำแล้วลูกค้าใช้งานได้จริง ได้ไหมครับ")?.segment).toBe(
      "details",
    );
    expect(detectAdEntry("ขอรายละเอียดคอร์ส AI Basic หน่อยครับ")).toBeNull();
  });
});

describe("ด่าน 1 ตาม BOT-VOICE: คำถามแรกแบบมีปุ่ม", () => {
  it("กลุ่ม 10M+ ถามงานก่อน พร้อม 5 ปุ่ม · ไม่ถามขนาดทีม", () => {
    const o = openingParts({ segment: "big", button: "x", revenueBand: null });
    expect(o.parts).toEqual([{ text: VOICE.taskQ, replies: TASK_BUTTONS }]);
    expect(o.pending).toBe("task");
    expect(JSON.stringify(o)).not.toMatch(/กี่คน/);
  });

  it("กลุ่ม <10M: ประโยคราคา 14,000 ของต้น + คำถามแยกเป็นข้อความที่ 2 (มีปุ่มอยากเรียนเอง)", () => {
    const o = openingParts({ segment: "small", button: "x", revenueBand: null });
    expect(o.parts[0].text).toBe(SCRIPT.smallOpen);
    expect(o.parts[0].text).toContain("14,000 บาท");
    expect(o.parts[1].replies?.map((r) => r.title)).toContain("อยากเรียนเอง");
  });

  it("ทุกปุ่มยาวไม่เกิน 20 ตัวอักษร (ลิมิต Messenger) และไม่ถูกตัด", () => {
    for (const b of [...TASK_BUTTONS, ...TASK_BUTTONS_SMALL, ...USECASE_BUTTONS]) expect(b.title.length).toBeLessThanOrEqual(20);
  });
});

describe("กติกาเสียง (BOT-VOICE ข้อ 1)", () => {
  const all = [...Object.values(SCRIPT), ...Object.values(VOICE), ...Object.values(CASES).map((c) => c.text)];
  it("ไม่มี 'ทีมงาน' ในข้อความถึงลูกค้า (ต้นเคาะใช้ 'ผม')", () => {
    for (const t of all) expect(t).not.toContain("ทีมงาน");
  });
  it("ไม่มีคำต้องห้าม", () => {
    for (const t of all) {
      expect(t).not.toMatch(/ยินดีอย่างยิ่ง|เพื่อให้ข้อมูลได้ตรงจุด|ขออนุญาตช่วยให้ตอบง่ายขึ้น|หวังว่าจะเป็นประโยชน์|รบกวนขอข้อมูล|ขอบพระคุณ|มีอะไรให้ช่วยอีกไหม/);
    }
  });
  it("ไม่มีเคสยานยนต์ (ต้นไม่อนุมัติ) — มีแค่ 4 เคสในสคริปต์", () => {
    expect(Object.keys(CASES)).toEqual(["mill", "group", "insurance", "agent"]);
    expect(JSON.stringify(Q)).not.toMatch(/Automotive|ยานยนต์/);
    expect(pickCase("ศูนย์บริการรถยนต์").key).toBe("agent");
  });
  it("ราคาด่าน 5 ใช้คำต้นเป็นค่าเริ่มต้น", () => {
    expect(priceText()).toBe(SCRIPT.price);
    expect(priceText()).toContain("ประเมินเป็นโปรเจกต์ หลังเห็นขอบเขตงาน");
  });
});

describe("เคสตามธุรกิจ (สคริปต์ด่าน 3 คำต่อคำ)", () => {
  it.each([
    ["โรงสีข้าว", "mill", CASES.mill.text],
    ["โรงงานฉีดพลาสติก", "mill", "คนละอุตสาหกรรมกัน"],
    ["กลุ่มบริษัท 5 บริษัท", "group", CASES.group.text],
    ["ประกันภัย", "insurance", CASES.insurance.text],
    ["คลินิกความงาม", "agent", CASES.agent.text],
  ])("%s → %s", (biz, key, text) => {
    const c = pickCase(biz);
    expect(c.key).toBe(key);
    expect(c.text).toContain(text);
  });
  it("โรงสียัง 'กำลัง' ย้าย ห้ามเปลี่ยนเป็นเสร็จแล้ว", () => {
    expect(CASES.mill.text).toContain("กำลังย้าย");
  });
});

describe("detectInterjection — คำถามใหม่ตาม BOT-VOICE 3.2–3.7", () => {
  it.each([
    ["มีตัวอย่างไหมครับ", "task", "references"],
    ["มีลูกค้าอ้างอิงไหม", "pain", "references"],
    ["SI?", "pain", "si"],
    ["เป็น SI หรือเปล่าครับ", "task", "si"],
    ["ขอสรุปภาพรวมก่อนได้ไหม", "task", "overview"],
    ["อยากได้วิธีทำ workflow เลย", "task", "workflow"],
    ["ผมอยากได้แบบวิธีทำเลย", "task", "workflow"],
    ["นี่บอทตอบเหรอ", "pain", "is_bot"],
    ["คุยกับคนจริงหรือเปล่าครับ", "task", "is_bot"],
    ["ขอติดต่อลูกค้าเก่าได้ไหม", "pain", "old_customer"],
    ["เล่าเลย", "pain", "tell_case"],
    ["คุย", "pain", "appointment"],
    ["ราคาเท่าไรครับ", "task", "price"],
    ["ขอใบเสนอราคา", "pain", "price_detail"],
    ["แพงไปครับ", "pain", "negotiate"],
    ["ไม่สะดวกให้เบอร์ครับ", "contact", "decline"],
  ])("%s → %s", (text, pending, kind) => {
    expect(detectInterjection(text, pending as never)).toBe(kind);
  });

  it("คำว่าบอทที่เป็นงาน ไม่นับเป็นการถามว่าคุยกับบอท", () => {
    expect(isBotQuestion("อยากทำแชตบอทตอบลูกค้า")).toBe(false);
    expect(isBotQuestion("ทำแชตบอท")).toBe(false);
    expect(isBotQuestion("อยากให้ AI ตอบแชทลูกค้า")).toBe(false);
    expect(isBotQuestion("is this a bot?")).toBe(true);
  });

  it("ปุ่ม 'สรุปตัวเลขผู้บริหาร' ไม่ใช่การขอภาพรวม", () => {
    expect(detectInterjection("สรุปตัวเลขผู้บริหาร", "task")).toBeNull();
  });
});

describe("บั๊กคำถามถูกเก็บเป็นชื่อ (โฟลว์ชื่อ-เบอร์เดิม)", () => {
  it.each(["ผมอยากได้แบบวิธีทำเลย", "ราคาเท่าไรครับ", "ทำแชตบอทได้ไหม", "สนใจคอร์สครับ"])("'%s' ไม่ใช่ชื่อ", (t) => {
    expect(isLikelyName(t)).toBe(false);
  });
  it.each(["เอก", "สมชาย ใจดี", "Ton"])("'%s' เป็นชื่อได้", (t) => expect(isLikelyName(t)).toBe(true));
});

describe("ช่องติดต่อ + ด่านกันโมเดลแต่ง", () => {
  it("เบอร์ / LINE / อีเมล", () => {
    expect(extractContact("081-234-5678")).toMatchObject({ phone: "0812345678" });
    expect(extractContact("ไลน์ไอดี: ton.pa")).toMatchObject({ line: "ton.pa" });
    expect(extractContact("ton@example.com")).toMatchObject({ email: "ton@example.com" });
  });
  it("ทิ้งค่าที่มีราคา/ตัวเลขที่ลูกค้าไม่ได้พิมพ์ · ไม่รับช่องติดต่อหรือช่องนอก schema", () => {
    expect(
      sanitizeExtracted(
        { business_type: "ร้านกาแฟ งบ 50,000 บาท", pain: "ตอบแชทลูกค้า", contact: "0899999999", reply: "x" },
        "ร้านกาแฟครับ อยากให้ช่วยตอบแชทลูกค้า",
      ),
    ).toEqual({ pain: "ตอบแชทลูกค้า" });
  });
});

describe("ช่องเวลาว่าง (settings.meeting_slots)", () => {
  // พฤหัส 19 พ.ย. 2569 09:00 เวลาไทย (ตรวจแล้ว: 19 พ.ย. 2026 = วันพฤหัส)
  const now = new Date("2026-11-19T02:00:00Z");
  it("หยิบ 2 ช่องแรกที่ยังไม่ผ่าน", () => {
    expect(usableSlots("พุธ 18 พ.ย. 10:00\nศุกร์ 20 พ.ย. 14:00\nเสาร์ 21 พ.ย. 10:00\nอาทิตย์ 22 พ.ย. 09:00", now)).toEqual([
      "ศุกร์ 20 พ.ย. 14:00",
      "เสาร์ 21 พ.ย. 10:00",
    ]);
  });
  it("ชื่อวันไม่ตรงกับวันที่ → ข้าม (กันเสนอวันผิด)", () => {
    expect(usableSlots("จันทร์ 20 พ.ย. 14:00\nเสาร์ 21 พ.ย. 10:00", now)).toEqual([]);
    // ตัวอย่างใน BOT-VOICE 3.8 ("อังคาร 25 พ.ย." · "พฤหัส 27 พ.ย.") ชื่อวันไม่ตรงจริง (25 = พุธ · 27 = ศุกร์)
    expect(usableSlots("อังคาร 25 พ.ย. 10:00\nพฤหัส 27 พ.ย. 14:00", now)).toEqual([]);
  });
  it("ว่าง / ได้ช่องเดียว → [] (ทุกคำขอนัดส่งต่อต้น)", () => {
    expect(usableSlots("", now)).toEqual([]);
    expect(usableSlots("เสาร์ 21 พ.ย. 10:00", now)).toEqual([]);
  });
  it("ชวนนัดด่าน 4 มีบรรทัดคุยฟรีตามคำต้น + 2 ตัวเลือก + ปุ่ม", () => {
    const p = inviteParts(["พฤหัส 20 พ.ย. 14:00", "ศุกร์ 21 พ.ย. 10:00"]);
    expect(p[0].text).toBe(SCRIPT.invite1);
    expect(p[1].text).toContain(FREE_CALL_LINE);
    expect(p[1].text).toContain("สะดวก พฤหัส 20 พ.ย. 14:00 หรือ ศุกร์ 21 พ.ย. 10:00 ครับ");
    expect(p[1].replies?.map((r) => r.title)).toEqual(["พฤหัส 20 พ.ย. 14:00", "ศุกร์ 21 พ.ย. 10:00", "ไม่สะดวกทั้งคู่"]);
  });
});

describe("workflow / automation → AI Agentic (02)", () => {
  it.each(["อยากทำ workflow อนุมัติเอกสาร", "งานซ้ำทุกวัน อยากให้ทำงานอัตโนมัติ", "automation ส่งรายงาน"])("%s", (t) => {
    expect(recommendCourses(t)[0].id).toBe("02");
  });
  it("งานเกี่ยวกับเมล/ปฏิทิน → เติมข้อความแอป · ไม่เกี่ยว → ไม่เติม", () => {
    expect(workflowParts("ตอบอีเมลลูกค้าซ้ำทุกวัน").parts.map((p) => p.text)).toContain(VOICE.workflowApps);
    expect(workflowParts("กรอกข้อมูลลง Excel ซ้ำทุกวัน").parts.map((p) => p.text)).not.toContain(VOICE.workflowApps);
  });
  it("รูปแบบบรรทัดคอร์ส/ราคาใหม่ (Online/Onsite/ท่านต่อไป)", () => {
    expect(courseLine(courseById("04")!)).toBe("• LINE ChatBot 4 ชม. · ต้องผ่าน AI Agentic ก่อน");
    expect(coursePriceLine(courseById("02")!)).toBe("• AI Agentic 4 ชม.\nOnline 4,500 · Onsite 7,000 · ท่านต่อไป 4,000 บาท");
  });
});

describe("ร่างตามรอบ 2 + สรุป", () => {
  it("รู้ปัญหา / ไม่รู้ / อยากเรียนเอง", () => {
    const d = newDraft({ segment: "big", button: "x", revenueBand: null }, "task");
    expect(roundTwoDraft(d)).toContain("ยังสนใจเอา AI มาช่วยงานในบริษัทอยู่ไหมครับ");
    d.fields.pain = "รวมยอด";
    expect(roundTwoDraft(d)).toContain("ยังสนใจเรื่อง[ปัญหา]อยู่ไหมครับ");
    const s = newDraft({ segment: "self_learn", button: "x", revenueBand: null }, "use_case");
    s.recommended = ["04"];
    expect(roundTwoDraft(s)).toContain("ยังสนใจเรียนLINE ChatBotอยู่ไหมครับ");
    expect(roundTwoDraft(s)).toContain("ผมจะไม่ทักซ้ำ");
  });
  it("สรุปมีชื่อโปรไฟล์ ปุ่มที่กด ช่องที่ได้ ร่างรอบ 2 และลิงก์", () => {
    const d = newDraft({ segment: "big", button: "100 ล้านขึ้นไป", revenueBand: "100M+" }, "pain");
    d.fields.task = "งานในโรงงาน";
    const s = buildSummary(d, "ได้ข้อมูลครบ", "https://x.test/admin/inbox/c1", "สมมติ ชื่อ", roundTwoDraft(d));
    expect(s).toContain("ชื่อในโปรไฟล์: สมมติ ชื่อ");
    expect(s).toContain("ปุ่มที่กด: 100 ล้านขึ้นไป");
    expect(s).toContain("อยากให้ AI ช่วยงาน: งานในโรงงาน");
    expect(s).toContain("ร่างตามรอบ 2");
    expect(s).toContain("https://x.test/admin/inbox/c1");
  });
});

describe("คอร์ส — ต้องตรงกับ MASTER ของต้น", () => {
  const masterPath = path.join(os.homedir(), "Documents/Claude/Projects/AI Course/MASTER.yaml");
  it.skipIf(!fs.existsSync(masterPath))("รายชื่อ ชั่วโมง prereq tier และราคา ตรงกับ MASTER.yaml", () => {
    const y = fs.readFileSync(masterPath, "utf8");
    const master = y
      .split(/\n- id: '/)
      .slice(1)
      .map((b) => ({
        id: b.slice(0, 2),
        name: b.match(/\n  name: (.+)/)?.[1].trim(),
        hours: Number(b.match(/\n  duration_hours: (\d+)/)?.[1]),
        prereq: b.match(/\n  prereq: '(\d*)'/)?.[1] ?? "",
        tier: b.match(/\n  pricing_tier: (\w+)/)?.[1],
      }))
      .filter((c) => c.name);
    expect(COURSES).toEqual(master);
    const tiers = "\n" + y.split("\npricing_tiers:\n")[1].split("\ncourses:\n")[0];
    for (const tier of ["entry", "kids", "standard", "advanced"] as const) {
      const sec = tiers.split(`\n  ${tier}:\n`)[1]?.split(/\n  \w+:\n/)[0] ?? "";
      const num = (k: string) => Number(sec.match(new RegExp(`\\n    ${k}: (\\d+)`))?.[1]);
      expect(TIER_PRICES[tier]).toEqual({ online: num("online"), onsite: num("onsite"), nextPerson: num("next_person") });
    }
  });
});
