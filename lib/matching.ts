/**
 * ตรรกะจับคู่ข้อความ — เขียนเป็นฟังก์ชันบริสุทธิ์ (ไม่แตะฐานข้อมูล/เครือข่าย)
 * เพื่อให้เขียนเทสต์ครอบได้ทุกกิ่ง
 */

export type MatchType = "contains" | "exact" | "regex";
export type RuleAction = "reply" | "collect_lead" | "handoff" | "menu";

export interface Rule {
  id: string;
  name: string;
  match_type: MatchType;
  pattern: string;
  action: RuleAction;
  reply_text: string | null;
  quick_replies: { title: string; payload: string }[] | null;
  priority: number;
}

/** ตัดช่องว่างซ้ำ ตัดวรรณยุกต์ที่พิมพ์เกิน และทำเป็นตัวพิมพ์เล็ก เพื่อให้เทียบง่ายขึ้น */
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "") // อักขระล่องหนที่ติดมาจากการคัดลอก
    .replace(/\s+/g, " ")
    .trim();
}

/** คำสั่งพิเศษที่ต้องมาก่อนทุกกติกา */
export type SpecialCommand = "handoff" | "menu" | "stop_bot" | null;

const HANDOFF_WORDS = [
  "คุยกับคน",
  "คุยกับแอดมิน",
  "ขอแอดมิน",
  "ต่อแอดมิน",
  "เรียกแอดมิน",
  "ขอคุยกับเจ้าหน้าที่",
  "คุยกับต้น",
  "ขอสายต้น",
  "talk to human",
  "human agent",
];
const MENU_WORDS = ["เมนู", "menu", "เริ่มใหม่", "start over"];
const STOP_WORDS = ["หยุดบอต", "ปิดบอต", "stop bot"];

export function detectSpecialCommand(text: string): SpecialCommand {
  const t = normalize(text);
  if (STOP_WORDS.some((w) => t.includes(w))) return "stop_bot";
  if (HANDOFF_WORDS.some((w) => t.includes(w))) return "handoff";
  if (MENU_WORDS.some((w) => t === w || t.includes(w))) return "menu";
  return null;
}

/** จับคู่กติกาทีละข้อตามลำดับความสำคัญ — เจอข้อแรกแล้วหยุด */
export function matchRule(text: string, rules: Rule[]): Rule | null {
  const t = normalize(text);
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const p = normalize(rule.pattern);
    if (rule.match_type === "exact" && t === p) return rule;
    if (rule.match_type === "contains" && p !== "" && t.includes(p)) return rule;
    if (rule.match_type === "regex") {
      try {
        // กันกติกาที่เขียนผิดทำให้ทั้งระบบล้ม
        if (new RegExp(rule.pattern, "i").test(text)) return rule;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** ดึงเบอร์โทรไทยออกจากข้อความ (รับทั้ง 08x-xxx-xxxx, +66, มีเว้นวรรค) */
export function extractPhone(text: string): string | null {
  const cleaned = text.replace(/[\s\-().]/g, "");
  const thai = cleaned.match(/(?:\+?66|0)\d{8,9}/);
  if (!thai) return null;
  let n = thai[0];
  if (n.startsWith("+66")) n = "0" + n.slice(3);
  else if (n.startsWith("66") && n.length >= 11) n = "0" + n.slice(2);
  return n.length >= 9 && n.length <= 10 ? n : null;
}

export function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

/** ลูกค้าปฏิเสธการให้ข้อมูลไหม */
export function isDecline(text: string): boolean {
  const t = normalize(text);
  return ["ไม่สะดวก", "ไม่ให้", "ไม่บอก", "ขอผ่าน", "ไม่อยากให้", "no thanks"].some((w) =>
    t.includes(w),
  );
}

/** คำถามนี้ดูเป็นงานองค์กรไหม — ใช้จัดประเภท lead */
export function looksCorporate(text: string): boolean {
  const t = normalize(text);
  const words = ["บริษัท", "องค์กร", "in-house", "inhouse", "หน่วยงาน", "พนักงาน", "ใบเสนอราคา", "จัดอบรม"];
  if (words.some((w) => t.includes(w))) return true;
  // "hr" ต้องเป็นคำเดี่ยว ไม่งั้น "chrome" หรือ "three" จะถูกนับเป็นงานองค์กร
  return /\bhr\b/.test(t);
}
