/**
 * โฟลว์คัดลูกค้าจากแอด Messenger (ด่าน 1–6 ของสคริปต์ต้น)
 *
 * หลักการ:
 *  - ข้อความที่ส่งหาลูกค้า "ทุกประโยค" เป็นข้อความคงที่ในไฟล์นี้ — ถอดคำต่อคำจาก
 *    AI Business/03_Sales/Portfolio/ads/Messenger_Chat_Script.md (ที่ต้นเขียนเอง)
 *    ประโยคไหนที่สคริปต์ไม่มี จะเขียนเพิ่มให้สั้นที่สุดและติดป้าย [เพิ่มเอง] ไว้ในคอมเมนต์
 *  - โมเดลทำได้แค่ "สกัดค่าใส่ช่อง" (lib/ai.ts → extractQualifierFields) ห้ามแต่งข้อความหาลูกค้า
 *  - ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ทั้งหมด (ไม่แตะฐานข้อมูล/เครือข่าย) เพื่อให้เทสต์ครอบได้ทุกกิ่ง
 */
import { normalize, extractEmail, extractPhone, isDecline } from "./matching";
import { findUnsupportedFacts } from "./guard";
import { recommendCourses, coursePriceLine, courseById, courseLine, COURSES, TIER_PRICES } from "./courses";

export type Segment = "big" | "small" | "self_learn" | "details";

export type QField =
  | "business_type"
  | "team_size"
  | "pain"
  | "decision_maker"
  | "timeline"
  | "use_case"
  | "name"
  | "contact";

export interface QualDraft {
  flow: "qualifier";
  segment: Segment;
  /** ข้อความปุ่ม/ข้อความแรกที่ลูกค้าส่งมา (เก็บตามจริง ไว้โชว์ในสรุป) */
  button: string;
  revenueBand: string | null;
  fields: Partial<Record<QField, string>>;
  skipped: QField[];
  pending: QField | null;
  /** ถามช่องเดิมซ้ำไปกี่ครั้งแล้ว (ตอบไม่ตรง / ช่องทางติดต่อผิดรูป) */
  retries: number;
  /** ตอบนอกเรื่องติดกันกี่ครั้ง — ครบ 2 ส่งต่อคน */
  offTopic: number;
  priceAsked: number;
  consentShown: boolean;
  consentAt: string | null;
  /** คำถามที่ลูกค้าถามแต่บอตไม่ได้ตอบ (ให้คนตอบต่อ) */
  questions: string[];
  recommended: string[];
}

// ── ถ้อยคำจากสคริปต์ (ห้ามแก้คำ ถ้าจะแก้ ให้แก้สคริปต์ของต้นก่อนแล้วตามมาแก้ตรงนี้) ──────────
export const SCRIPT = {
  // ด่าน 1 · กด 10–100 ล้าน / 100 ล้านขึ้นไป
  bigOpen: "ขอบคุณครับ ขอถามสั้น ๆ อีก 2 ข้อนะครับ\nธุรกิจของคุณทำเกี่ยวกับอะไร ทีมประมาณกี่คนครับ",
  pain: "ตอนนี้งานส่วนไหนที่กินเวลาทีมมากที่สุด หรืออยากให้ AI ช่วยเรื่องไหนก่อนครับ",
  // ด่าน 1 · กด ต่ำกว่า 10 ล้าน
  smallOpen:
    "ขอบคุณครับ ธุรกิจของคุณทำเกี่ยวกับอะไร และอยากให้ AI ช่วยเรื่องไหนครับ\n\n" +
    "งานที่ปรึกษาของผมเริ่มที่ครึ่งวัน 14,000 บาท ถ้ายังอยากลองเองก่อน ผมมีคอร์สสอนเป็นกลุ่มด้วยครับ",
  // ด่าน 1 · กด อยากเรียน AI เอง
  selfOpen:
    "ได้เลยครับ ผมมีคอร์สสอนเป็นกลุ่ม ทั้งออนไลน์และที่ออฟฟิศ\n" +
    "สนใจใช้ AI กับงานแบบไหนครับ เช่น งานเอกสาร ทำคอนเทนต์ ทำแชตบอท หรือทำเว็บ",
  // ด่าน 2
  decision: "เรื่องนี้คุณตัดสินใจเองได้เลย หรือต้องคุยกับหุ้นส่วนหรือผู้บริหารคนอื่นด้วยครับ",
  timeline: "อยากเห็นผลภายในเมื่อไรครับ",
  // ด่าน 5
  price:
    "ขึ้นอยู่กับว่าใครเป็นคนลงมือครับ\n" +
    "• ผมโค้ชให้ทีมคุณทำเอง: ครึ่งวัน 14,000 / เต็มวัน 22,000\n" +
    "• ผมทำระบบให้: ประเมินเป็นโปรเจกต์ หลังเห็นขอบเขตงาน\n" +
    "ส่วนใหญ่เริ่มจากครึ่งวันก่อน เพื่อวางว่าทำอะไรก่อนหลังครับ",
  // ด่าน 6
  thinkLater:
    "ได้ครับ ติดตรงไหนบอกผมได้นะครับ เรื่องงบ เวลา หรือยังไม่แน่ใจว่า AI ช่วยได้จริง ผมจะได้ส่งข้อมูลที่ตรงให้",
  details: "ผลงานที่ผ่านมาอยู่ที่นี่ครับ tonpalearn.com/portfolio\nดูแล้วส่วนไหนใกล้กับธุรกิจคุณที่สุดครับ",
  expensive:
    "เริ่มจากเรื่องเดียวที่เจ็บที่สุดก่อนได้ครับ ครึ่งวันพอ ไม่ต้องทำทั้งระบบ เห็นผลแล้วค่อยตัดสินใจต่อ",
  hasIt: "ดีเลยครับ งานแบบนี้ผมโค้ชให้ทีม IT ทำเองได้ ระบบจะเป็นของทีมคุณเอง ไม่ต้องพึ่งผมตลอด",
} as const;

// ── ถ้อยคำที่สคริปต์ไม่มี [เพิ่มเอง] — สั้น สุภาพ ไม่สัญญาเวลา/ผลลัพธ์ ──────────────────────
export const EXTRA = {
  businessType: "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ",
  teamSize: "ทีมประมาณกี่คนครับ",
  useCase: "สนใจใช้ AI กับงานแบบไหนครับ เช่น งานเอกสาร ทำคอนเทนต์ ทำแชตบอท หรือทำเว็บ",
  consent:
    "ขอชื่อกับเบอร์โทรหรือ LINE ไว้ให้ทีมงานติดต่อกลับนะครับ " +
    "ข้อมูลนี้ใช้ติดต่อเรื่องนี้เท่านั้น ถ้าอยากให้ลบภายหลังบอกได้เลยครับ " +
    "ถ้าไม่สะดวก พิมพ์ว่า ไม่สะดวก ได้ครับ",
  name: "ขอทราบชื่อที่ให้เรียกก่อนครับ",
  contact: "ขอเบอร์โทรหรือ LINE ID สำหรับติดต่อกลับครับ",
  contactRetry: "ขอเป็นเบอร์โทร 10 หลัก หรือ LINE ID ก็ได้ครับ",
  offTopic: "ขอบคุณครับ ขอถามอีกนิดนะครับ",
  questionNoted: "เรื่องนี้เดี๋ยวทีมงานตอบละเอียดให้ในแชทนี้นะครับ ขอถามอีกนิดครับ",
  selfIntro: "คอร์สที่ตรงกับงานแบบนี้ครับ",
  selfAskContact: "ถ้าอยากให้ทีมงานแจ้งรอบเรียนที่เปิดอยู่",
  doneConsult: "ขอบคุณครับ ได้ข้อมูลครบแล้ว ผมสรุปเรื่องไว้ให้ทีมงานแล้ว เดี๋ยวทีมงานทักกลับไปนัดคุยนะครับ",
  doneSelf: "ขอบคุณครับ ได้ข้อมูลครบแล้ว เดี๋ยวทีมงานทักกลับไปแจ้งรอบเรียนนะครับ",
  declinedContact: "ได้ครับ ไม่เก็บช่องทางติดต่อนะครับ เดี๋ยวทีมงานตอบต่อในแชทนี้ครับ",
  toHuman: "เรื่องนี้ขอให้ทีมงานมาคุยต่อในแชทนี้นะครับ ระหว่างรอ พิมพ์ทิ้งไว้ได้เลยครับ",
  appointment: "ได้เลยครับ เรื่องวันเวลาเดี๋ยวทีมงานมาคุยนัดต่อในแชทนี้นะครับ",
  negotiateTail: "เดี๋ยวทีมงานมาคุยรายละเอียดต่อในแชทนี้นะครับ",
  priceDetail: "ราคาแบบละเอียดขึ้นกับขอบเขตงานครับ เดี๋ยวทีมงานมาคุยต่อในแชทนี้นะครับ",
} as const;

export const FIELD_LABEL: Record<QField, string> = {
  business_type: "ธุรกิจ",
  team_size: "ขนาดทีม",
  pain: "งานที่กินเวลา/อยากให้ AI ช่วย",
  decision_maker: "ตัดสินใจ",
  timeline: "อยากเห็นผล",
  use_case: "อยากใช้ AI กับงาน",
  name: "ชื่อ",
  contact: "ติดต่อ",
};

const SEGMENT_LABEL: Record<Segment, string> = {
  big: "ธุรกิจ 10 ล้านขึ้นไป",
  small: "ธุรกิจต่ำกว่า 10 ล้าน",
  self_learn: "อยากเรียน AI เอง",
  details: "ขอรายละเอียด/ตัวอย่างงาน",
};

const ORDER: Record<Segment, QField[]> = {
  big: ["business_type", "team_size", "pain", "decision_maker", "timeline", "name", "contact"],
  details: ["business_type", "team_size", "pain", "decision_maker", "timeline", "name", "contact"],
  small: ["business_type", "pain", "team_size", "decision_maker", "timeline", "name", "contact"],
  self_learn: ["use_case", "name", "contact"],
};

export function fieldOrder(segment: Segment): QField[] {
  return ORDER[segment];
}

// ── จับปุ่มยอดขาย/ข้อความแนวเดียวกัน ────────────────────────────────────────────
export interface AdEntry {
  segment: Segment;
  button: string;
  revenueBand: string | null;
}

/** แปลงขีดทุกแบบ (– — − ~) เป็น - และตัดช่องว่าง เพื่อให้จับ "10–100 ล้าน" / "10-100ล้าน" ได้เหมือนกัน */
function compact(text: string): string {
  return normalize(text).replace(/[–—−~]/g, "-").replace(/\s+/g, "");
}

export function detectAdEntry(text: string): AdEntry | null {
  const raw = (text ?? "").trim();
  if (raw === "") return null;
  const c = compact(raw);
  const button = raw.slice(0, 120);

  if (/^(ยอดขาย|รายได้)?ต่ำกว่า10ล้าน|^(ยอดขาย|รายได้)?น้อยกว่า10ล้าน/.test(c))
    return { segment: "small", button, revenueBand: "<10M" };
  if (/^(ยอดขาย|รายได้)?100ล้าน(บาท)?(ขึ้นไป|\+)/.test(c) || /^(ยอดขาย|รายได้)?(มากกว่า|เกิน)100ล้าน/.test(c))
    return { segment: "big", button, revenueBand: "100M+" };
  if (/^(ยอดขาย|รายได้)?10-100ล้าน|^(ยอดขาย|รายได้)?10ถึง100ล้าน/.test(c))
    return { segment: "big", button, revenueBand: "10-100M" };
  if (/^อยากเรียน(ai)?เอง|^อยากเรียนai/.test(c)) return { segment: "self_learn", button, revenueBand: null };

  // พิมพ์ยอดเองสั้น ๆ เช่น "10 ล้าน" "50ล้านครับ" — ตัดสินจากตัวเลข
  const typed = c.match(/^(?:ยอดขาย|รายได้|ประมาณ)?(\d+(?:\.\d+)?)ล้าน(?:บาท)?(?:ครับ|ค่ะ|คะ|ต่อปี|\/ปี)*$/);
  if (typed) {
    const n = Number(typed[1]);
    if (n < 10) return { segment: "small", button, revenueBand: `ระบุเอง ${typed[1]} ล้าน` };
    return { segment: "big", button, revenueBand: `ระบุเอง ${typed[1]} ล้าน` };
  }

  // ขอรายละเอียดบริการ/ตัวอย่างงาน (ด่าน 6) — ทนคำพิมพ์ผิด "ราบละเอียด"
  // แต่ถ้าถามถึง "คอร์ส" ให้ชั้นปกติของบอตตอบ ไม่ลากเข้าโฟลว์ที่ปรึกษา
  if (!/คอร์ส/.test(c) && isDetailsRequest(c)) return { segment: "details", button, revenueBand: null };
  return null;
}

function isDetailsRequest(c: string): boolean {
  return /ตัวอย่าง|ผลงาน|portfolio|พอร์ตโฟลิโอ|เคสจริง|กรณีศึกษา|(ขอ|ส่ง|อยากได้|มี).{0,6}(รายละเอียด|ราบละเอียด|ละเอียด)/.test(c);
}

/** ข้อความแรกตามปุ่มที่กด + ช่องที่ถือว่า "กำลังถาม" อยู่ */
export function openingMessage(entry: AdEntry): { text: string; pending: QField } {
  switch (entry.segment) {
    case "big":
      return { text: SCRIPT.bigOpen, pending: "business_type" };
    case "small":
      return { text: SCRIPT.smallOpen, pending: "business_type" };
    case "self_learn":
      return { text: SCRIPT.selfOpen, pending: "use_case" };
    case "details":
      return { text: SCRIPT.details, pending: "business_type" };
  }
}

export function newDraft(entry: AdEntry, pending: QField): QualDraft {
  return {
    flow: "qualifier",
    segment: entry.segment,
    button: entry.button,
    revenueBand: entry.revenueBand,
    fields: {},
    skipped: [],
    pending,
    retries: 0,
    offTopic: 0,
    priceAsked: 0,
    consentShown: false,
    consentAt: null,
    questions: [],
    recommended: [],
  };
}

export function isQualDraft(v: unknown): v is QualDraft {
  return Boolean(v && typeof v === "object" && (v as { flow?: unknown }).flow === "qualifier");
}

/** ช่องถัดไปที่ยังไม่ได้และไม่ได้ข้าม */
export function nextField(d: QualDraft): QField | null {
  for (const f of ORDER[d.segment]) {
    if (d.fields[f]) continue;
    if (d.skipped.includes(f)) continue;
    return f;
  }
  return null;
}

/**
 * ข้อความถามช่องนี้ — ถ้าเป็นช่องข้อมูลส่วนตัว (ชื่อ/ติดต่อ) และยังไม่เคยแจ้ง
 * ต้องแจ้งว่าเก็บไว้ทำอะไรก่อนเสมอ (คืน consentShown=true ให้คนเรียกบันทึก)
 */
export function questionFor(field: QField, d: QualDraft): { text: string; consentShown: boolean } {
  const personal = field === "name" || field === "contact";
  const lead = d.segment === "self_learn" ? `${EXTRA.selfAskContact} ` : "";
  const prefix = personal && !d.consentShown ? `${lead}${EXTRA.consent}\n\n` : "";
  const q: Record<QField, string> = {
    business_type: EXTRA.businessType,
    team_size: EXTRA.teamSize,
    pain: SCRIPT.pain,
    decision_maker: SCRIPT.decision,
    timeline: SCRIPT.timeline,
    use_case: EXTRA.useCase,
    name: EXTRA.name,
    contact: EXTRA.contact,
  };
  return { text: prefix + q[field], consentShown: d.consentShown || personal };
}

// ── สิ่งที่ลูกค้าพิมพ์แทรกระหว่างทาง (จับด้วยโค้ด ไม่ใช้โมเดล) ────────────────────────────
export type Interjection =
  | "appointment"
  | "negotiate"
  | "price_detail"
  | "price"
  | "think_later"
  | "has_it"
  | "details"
  | "decline";

export function detectInterjection(text: string, pending: QField | null): Interjection | null {
  const t = normalize(text);
  const c = t.replace(/\s+/g, "");

  // ปฏิเสธ — ต้องมาก่อน เพราะ "ไม่สะดวกให้เบอร์" มีคำอื่นปนได้
  // ช่องธุรกิจ: นับเป็นปฏิเสธเฉพาะข้อความสั้น ๆ เพราะคำตอบจริงมีคำว่า "ไม่ให้" ปนได้
  // เช่น "อยากให้ AI ช่วยไม่ให้ทีมต้องกรอกมือ"
  const personal = pending === "name" || pending === "contact";
  if (/ไม่ให้เบอร์|ไม่สะดวกให้|ขอไม่ให้|ไม่ขอให้|ขอไม่ตอบ|ไม่ขอตอบ|ไม่สะดวกบอก|ขอข้าม|ข้ามไป/.test(c)) return "decline";
  if (isDecline(t) && (personal || c.length <= 20)) return "decline";

  // ขอนัด — บอตห้ามรับนัดวันเวลาเอง ส่งให้คน
  if (/ขอนัด|นัดคุย|นัดเวลา|นัดได้|อยากนัด|ว่างวันไหน|สะดวกวันไหน|ว่างกี่โมง|คุยทางzoom|zoomได้|ซูมได้|โทรคุย|โทรหาผม|โทรหาหน่อย|โทรกลับ|ขอเจอ/.test(c))
    return "appointment";

  // ต่อรอง
  if (/ลดได้ไหม|ลดได้มั้ย|ลดราคา|ส่วนลด|ต่อรอง|ถูกกว่านี้|ลดหน่อย|แพงไป|แพงจัง|แพงมาก|^แพง/.test(c)) return "negotiate";

  // ถามราคาละเอียด (ระบบ/โปรเจกต์/ใบเสนอราคา) → ให้คน
  const priceWord = /ราคา|เท่าไร|เท่าไหร่|กี่บาท|ค่าใช้จ่าย|ค่าบริการ|ค่าเรียน|ค่าคอร์ส/.test(c);
  const asking = /เท่าไร|เท่าไหร่|กี่บาท|ไหม|มั้ย|ยังไง|อย่างไร|เริ่ม|ประมาณ|คิดยังไง|\?|ขอ/.test(c);
  if (/ใบเสนอราคา|quotation|ใบquote/.test(c)) return "price_detail";
  if (priceWord && asking) {
    if (/ทำระบบ|โปรเจกต์|โปรเจค|project|ทั้งระบบ|ราคาละเอียด|แยกรายการ/.test(c)) return "price_detail";
    return "price";
  }

  if (/ขอคิดดู|ขอคิดก่อน|เดี๋ยวคิดดู|ขอไปคิด|ขอเวลาคิด/.test(c)) return "think_later";
  // "มีทีม IT" — ข้ามถ้ากำลังถามขนาดทีมหรือธุรกิจ เพราะอาจเป็นคำตอบ เช่น "บริษัทไอที ทีม 10 คน"
  if (pending !== "team_size" && pending !== "business_type" && /มี(ทีม)?(it|ไอที)(อยู่แล้ว)?|มีโปรแกรมเมอร์/.test(c))
    return "has_it";
  if (isDetailsRequest(c)) return "details";
  return null;
}

// ── สกัดค่าแบบไม่ใช้โมเดล (ใช้ตอนโมเดลใช้ไม่ได้ และใช้กับช่องติดต่อเสมอ) ────────────────────

export interface ContactInfo {
  phone: string | null;
  email: string | null;
  line: string | null;
}

export function extractContact(text: string): ContactInfo {
  const phone = extractPhone(text);
  const email = extractEmail(text);
  const lineMatch = text.match(/(?:line|ไลน์|ไลน)\s*(?:id|ไอดี)?\s*[:：]?\s*(@?[a-z0-9._-]{3,40})/i);
  let line = lineMatch ? lineMatch[1] : null;
  // พิมพ์มาแค่คำเดียวที่หน้าตาเป็นไอดี เช่น "@tonpa" หรือ "ton.pa" (ไม่ใช่เบอร์/อีเมล)
  if (!line && !phone && !email) {
    const solo = text.trim().match(/^@?[a-z][a-z0-9._-]{2,39}$/i);
    if (solo) line = solo[0];
  }
  return { phone, email, line };
}

export function contactToString(c: ContactInfo): string | null {
  const parts = [c.phone && `โทร ${c.phone}`, c.email && `อีเมล ${c.email}`, c.line && `LINE ${c.line}`].filter(
    Boolean,
  );
  return parts.length ? parts.join(" · ") : null;
}

const clip = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);
/** ตัดคำลงท้าย (ครับ/ค่ะ/นะครับ) ออกจากค่าที่เก็บ ให้สรุปอ่านง่าย */
const tidy = (s: string, n = 300) =>
  clip(s, n + 20)
    .replace(/\s*(นะ)?(ครับผม|ครับ|ค่ะ|คะ|จ้า|จ้ะ)\s*$/u, "")
    .trim()
    .slice(0, n);

/**
 * สกัดแบบกำหนดตายตัว: เอาคำตอบทั้งก้อนใส่ช่องที่กำลังถาม
 * + ดึงขนาดทีม ("20 คน") ออกมาได้เสมอ เพราะคำถามแรกของกลุ่มหลักถาม 2 อย่างในข้อความเดียว
 */
export function deterministicExtract(text: string, pending: QField | null): Partial<Record<QField, string>> {
  const out: Partial<Record<QField, string>> = {};
  const team = text.match(/(\d[\d,]*)\s*(?:คน|ท่าน|ชีวิต)/);
  if (team) out.team_size = `${team[1]} คน`;

  if (!pending || pending === "contact") return out;
  if (pending === "name") {
    out.name = tidy(text.replace(/^(ชื่อ|ผม|ดิฉัน|หนู|ฉัน|เรียก(ว่า)?)\s*/g, ""), 80);
    return out;
  }
  if (pending === "decision_maker") {
    const c = text.replace(/\s+/g, "");
    if (/หุ้นส่วน|ผู้บริหาร|หัวหน้า|บอส|เจ้านาย|ปรึกษา|ถาม|คุยกับ|อนุมัติ|ทีมบริหาร/.test(c)) out.decision_maker = "ต้องคุยกับคนอื่นด้วย";
    else if (/เอง|ได้เลย|เจ้าของ|ผมตัดสิน|ฉันตัดสิน|ดิฉันตัดสิน/.test(c)) out.decision_maker = "ตัดสินใจเองได้";
    else out.decision_maker = tidy(text, 120);
    return out;
  }
  if (pending === "team_size") {
    if (!out.team_size) out.team_size = tidy(text, 60);
    return out;
  }
  if (pending === "business_type") {
    const rest = tidy(text.replace(/(ทีม)?(ประมาณ|ราว ๆ|ราวๆ|ราว)?\s*\d[\d,]*\s*(คน|ท่าน|ชีวิต)/g, " "));
    if (rest.replace(/[\s,.ครับค่ะคะ]/g, "") !== "") out.business_type = rest;
    return out;
  }
  out[pending] = tidy(text);
  return out;
}

/**
 * ด่านกันโมเดลแต่ง: ค่าที่โมเดลสกัดมาต้องไม่มีตัวเลขเงิน/วันที่/เวลา ที่ลูกค้าไม่ได้พิมพ์
 * ชื่อต้องเป็นส่วนหนึ่งของข้อความจริง · ช่องติดต่อห้ามรับจากโมเดลเลย (ใช้ regex เท่านั้น)
 */
export function sanitizeExtracted(
  fields: Partial<Record<QField, string>>,
  customerText: string,
): Partial<Record<QField, string>> {
  const out: Partial<Record<QField, string>> = {};
  for (const [k, v] of Object.entries(fields) as [QField, string | undefined][]) {
    if (typeof v !== "string") continue;
    const val = clip(v);
    if (val === "") continue;
    if (k === "contact") continue;
    if (k === "name" && !customerText.includes(val)) continue;
    if (findUnsupportedFacts(val, [customerText]).length > 0) continue;
    // ตัวเลขเปล่า ๆ ที่ไม่มีในข้อความลูกค้า (เช่น ขนาดทีมที่เดาเอง) ก็ไม่รับ
    const nums = val.match(/\d[\d,]*/g) ?? [];
    if (nums.some((n) => !customerText.replace(/,/g, "").includes(n.replace(/,/g, "")))) continue;
    out[k] = val;
  }
  return out;
}

/** ข้อความนี้ดูเป็นคำถามที่ลูกค้าถามกลับ (ไม่ใช่คำตอบ) ไหม */
export function looksLikeQuestion(text: string): boolean {
  const c = normalize(text).replace(/\s+/g, "");
  return /\?|ไหม(ครับ|คะ|ค่ะ)?$|มั้ย(ครับ|คะ|ค่ะ)?$|หรือเปล่า|รึเปล่า|ได้ไหม|ได้มั้ย|ยังไง(ครับ|คะ)?$|อย่างไร/.test(c);
}

// ── ข้อความเฉพาะกลุ่มอยากเรียนเอง ─────────────────────────────────────────────

export function selfLearnRecommendation(useCase: string): { text: string; ids: string[] } {
  const picks = recommendCourses(useCase);
  return {
    text: `${EXTRA.selfIntro}\n${picks.map(courseLine).join("\n")}`,
    ids: picks.map((c) => c.id),
  };
}

/** ตอบราคาสำหรับกลุ่มอยากเรียนเอง — ใช้ตัวเลขจาก MASTER เท่านั้น */
export function selfLearnPrice(recommended: string[]): string {
  const list = (recommended.length ? recommended : ["01", "02"])
    .map((id) => courseById(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  return `ราคาคอร์สสอนเป็นกลุ่มครับ\n${list.map(coursePriceLine).join("\n")}`;
}

/** ตัวเลขเงินทั้งหมดที่บอต "อนุญาต" ให้พูดได้ (สคริปต์ + MASTER) — ใช้ในเทสต์กันแต่งราคา */
export function allowedMoneyFigures(): string[] {
  const fromScript = ["14000", "22000"];
  const fromMaster = Object.values(TIER_PRICES).flatMap((p) =>
    p ? [p.online, p.onsite, p.nextPerson].map(String) : [],
  );
  return [...new Set([...fromScript, ...fromMaster])];
}

// ── สรุปให้คน ───────────────────────────────────────────────────────────────

export function buildSummary(d: QualDraft, reason: string, link: string | null): string {
  const lines = [
    "ผู้สนใจใหม่จากแอด Messenger",
    `ปุ่มที่กด: ${d.button}`,
    `กลุ่ม: ${SEGMENT_LABEL[d.segment]}${d.revenueBand ? ` (${d.revenueBand})` : ""}`,
  ];
  for (const f of ORDER[d.segment]) {
    const v = d.fields[f];
    const skipped = d.skipped.includes(f);
    lines.push(`${FIELD_LABEL[f]}: ${v ?? (skipped ? "(ไม่ตอบ)" : "—")}`);
  }
  if (d.recommended.length) {
    lines.push(`คอร์สที่บอตแนะนำ: ${d.recommended.map((id) => COURSES.find((c) => c.id === id)?.name ?? id).join(", ")}`);
  }
  if (d.questions.length) lines.push(`ลูกค้าถามไว้ (ยังไม่มีคนตอบ): ${d.questions.join(" / ")}`);
  lines.push(`ส่งต่อเพราะ: ${reason}`);
  if (link) lines.push(`ดูแชท: ${link}`);
  return lines.join("\n");
}
