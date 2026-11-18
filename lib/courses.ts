/**
 * คอร์สและราคาที่บอตพูดได้ — คัดลอกจาก MASTER ของต้น ห้ามแต่งเพิ่มเอง
 *
 * ต้นฉบับ: ~/Documents/Claude/Projects/AI Course/MASTER.yaml (snapshot ของ MASTER.xlsx · generated 2026-10-20)
 * ถ้าต้นแก้ MASTER แล้ว ไฟล์นี้ต้องแก้ตาม — `tests/courses.test.ts` จะเทียบกับ MASTER.yaml ให้
 * ทุกครั้งที่รันเทสต์บนเครื่องที่มีไฟล์นั้น (บนเครื่องอื่นเทสต์ข้อนี้จะถูกข้าม)
 *
 * ตั้งใจไม่ใส่ราคา VDO: MASTER ยังมีงานค้าง "ยืนยัน Gumroad + ตั้งราคาจริง" อยู่ในหัวข้อ critical
 */

export type PricingTier = "entry" | "kids" | "standard" | "advanced" | "quote";

export interface Course {
  id: string;
  name: string;
  hours: number;
  prereq: string;
  tier: PricingTier;
}

export const COURSES: Course[] = [
  { id: "01", name: "AI Basic", hours: 2, prereq: "", tier: "entry" },
  { id: "02", name: "AI Agentic", hours: 4, prereq: "", tier: "standard" },
  { id: "03", name: "MCP Connector", hours: 4, prereq: "02", tier: "standard" },
  { id: "04", name: "LINE ChatBot", hours: 4, prereq: "02", tier: "standard" },
  { id: "05", name: "AI for Kids", hours: 2, prereq: "", tier: "kids" },
  { id: "06", name: "AI for Personal Assistant", hours: 2, prereq: "", tier: "entry" },
  { id: "07", name: "AI for ABOs", hours: 2, prereq: "", tier: "entry" },
  { id: "08", name: "AI Agentic Web Builder", hours: 4, prereq: "02", tier: "standard" },
  { id: "09", name: "AI Agentic App Builder", hours: 4, prereq: "08", tier: "advanced" },
  { id: "10", name: "AI Agentic Orchestra", hours: 4, prereq: "02", tier: "advanced" },
  { id: "11", name: "AI Content Creator System", hours: 4, prereq: "02", tier: "advanced" },
  { id: "12", name: "AI Agentic for IT Audit & Consult", hours: 4, prereq: "", tier: "quote" },
];

/** ราคาต่อ tier (บาท) — null = ตั้งราคารายดีล */
export const TIER_PRICES: Record<
  PricingTier,
  { online: number; onsite: number; nextPerson: number } | null
> = {
  entry: { online: 2500, onsite: 3000, nextPerson: 1500 },
  kids: { online: 3000, onsite: 3000, nextPerson: 2000 },
  standard: { online: 4500, onsite: 7000, nextPerson: 4000 },
  advanced: { online: 6000, onsite: 9000, nextPerson: 4500 },
  quote: null,
};

export function courseById(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

const baht = (n: number) => n.toLocaleString("en-US");

/** บรรทัดแนะนำคอร์ส (ไม่มีราคา) — รูปแบบตาม docs/BOT-VOICE.md ข้อ 2.4 */
export function courseLine(c: Course): string {
  const pre = c.prereq ? ` · ต้องผ่าน ${courseById(c.prereq)?.name ?? c.prereq} ก่อน` : "";
  return `• ${c.name} ${c.hours} ชม.${pre}`;
}

/** บรรทัดราคาของคอร์ส — ใช้เฉพาะตอนลูกค้าถามราคา/เลือกรูปแบบเรียน · คำ Online/Onsite/ท่านต่อไป ตามที่ต้นพิมพ์ในแชทจริง */
export function coursePriceLine(c: Course): string {
  const p = TIER_PRICES[c.tier];
  if (!p) return `• ${c.name}: ราคาตามขอบเขตงาน เดี๋ยวผมแจ้งให้ครับ`;
  return (
    `• ${c.name} ${c.hours} ชม.\n` +
    `Online ${baht(p.online)} · Onsite ${baht(p.onsite)} · ท่านต่อไป ${baht(p.nextPerson)} บาท`
  );
}

/**
 * เลือกคอร์สจากงานที่ลูกค้าอยากใช้ AI — จับคำสำคัญล้วน ๆ (ไม่ใช้โมเดล)
 * ไม่เจออะไรเลย → แนะนำสายเริ่มต้น 01 → 02 ตาม learning path "สายทั่วไป" ใน MASTER
 */
export function recommendCourses(useCase: string): Course[] {
  const t = useCase.toLowerCase();
  const picks: string[] = [];
  const add = (...ids: string[]) => ids.forEach((i) => !picks.includes(i) && picks.push(i));

  // งานซ้ำ / workflow / automation → AI Agentic (02) ก่อนเสมอ (BOT-VOICE ข้อ 3.5)
  if (/workflow|เวิร์กโฟลว์|เวิร์คโฟลว์|เวิร์กโฟล|ทำงานอัตโนมัติ|งานซ้ำ|automation|automate|อัตโนมัติ/.test(t)) add("02");
  if (/แชตบอท|แชทบอท|แชตบอต|แชทบอต|chat\s?bot|ตอบแชท|ไลน์\s?oa|line\s?oa|line bot|ไลน์บอท/.test(t)) add("04");
  if (/คอนเทนต์|คอนเท้นต์|content|โพสต์|คลิป|วิดีโอ|วีดีโอ|youtube|tiktok|ยูทูป/.test(t)) add("11");
  if (/เว็บ|web|landing|หน้าเพจขาย/.test(t)) add("08");
  if (/แอป|แอพ|\bapp\b|ฐานข้อมูล|database|login|ล็อกอิน/.test(t)) add("09");
  if (/เอเจนต์|agent|หลาย\s?agent|ทีม ai/.test(t)) add("02", "10");
  if (/เชื่อม|connector|mcp|google sheet|ชีต|drive/.test(t)) add("03");
  // ระวัง "ลูก" เฉย ๆ จะไปติด "ลูกค้า"
  if (/เด็ก|ลูกชาย|ลูกสาว|ให้ลูก|นักเรียน|ม\.\d/.test(t)) add("05");
  if (/เลขา|\bpa\b|ผู้ช่วยผู้บริหาร|ผู้ช่วยส่วนตัว/.test(t)) add("06");
  if (/เครือข่าย|แอมเวย์|amway|\babo\b|mlm|ขายตรง/.test(t)) add("07");
  if (/audit|ออดิท|ตรวจสอบภายใน|it audit/.test(t)) add("12");
  if (/เอกสาร|สรุป|อีเมล|email|รายงาน|prompt|พรอมต์|พื้นฐาน|เริ่มต้น|ไม่เคยใช้/.test(t)) add("01", "02");

  if (picks.length === 0) add("01", "02");
  return picks.slice(0, 3).map((id) => courseById(id)!).filter(Boolean);
}
