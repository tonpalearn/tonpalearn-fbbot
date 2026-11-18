/**
 * โฟลว์คัดลูกค้าจากแอด Messenger — ถ้อยคำ + ตรรกะล้วน (ไม่แตะฐานข้อมูล/เครือข่าย)
 *
 * ที่มาของถ้อยคำ (ห้ามแต่งเพิ่ม):
 *  - SCRIPT = คำของต้นในสคริปต์ AI Business/03_Sales/Portfolio/ads/Messenger_Chat_Script.md
 *  - VOICE  = ข้อความใหม่/ที่ปรับแล้ว ตาม docs/BOT-VOICE.md ข้อ 2–3 (ต้นอนุมัติทิศทาง 18 พ.ย. 2569)
 *  ลำดับการแก้: แก้สคริปต์/BOT-VOICE ก่อน แล้วค่อยตามมาแก้ไฟล์นี้
 *
 * ข้อที่ต้นตัดสินแล้ว (18 พ.ย. 2569):
 *  1. เสียง "ผม" ทุกที่ (ไม่มี "ทีมงาน") · ถูกถามว่าบอทไหม ตอบตรงว่าเป็นระบบตอบอัตโนมัติ
 *  2. คุยครั้งแรก 30 นาทีไม่มีค่าใช้จ่าย → บอตพูดได้ "ตอนชวนนัด" เท่านั้น (FREE_FIRST_CALL)
 *  3. ถามในแชท 4 ข้อ: งาน → ตรงไหนกินเวลา → ธุรกิจ → เบอร์/LINE · ชื่อเอาจากโปรไฟล์ Messenger ·
 *     ตัดสินใจเอง/อยากเห็นผล ไปถามตอนคุย
 *  4. ไม่มีเคสที่ 5 (ยานยนต์) — ใช้ 4 เคสในสคริปต์ด่าน 3 เท่านั้น
 * ข้อที่ยังรอต้น: office_hours (ไม่ใช้) · ถ้อยคำราคาแบบวง persona (PRICE_COPY ปิดไว้)
 */
import { normalize, extractEmail, extractPhone, isDecline } from "./matching";
import { findUnsupportedFacts } from "./guard";
import { recommendCourses, coursePriceLine, courseById, courseLine, COURSES, TIER_PRICES } from "./courses";

// ── สวิตช์ ───────────────────────────────────────────────────────────────
/** ต้นยืนยันแล้วว่าคุยครั้งแรกฟรี — ปิดเป็น false แล้วบอตจะไม่พูดเรื่องนี้ที่ไหนเลย */
export const FREE_FIRST_CALL = true;
/** ถ้อยคำราคาด่าน 5: "original" = คำต้น (ค่าเริ่มต้น) · "panel" = ฉบับวง persona (BOT-VOICE ข้อ 5 #8 · รอต้นเคาะ) */
export const PRICE_COPY: "original" | "panel" =
  process.env.PRICE_COPY === "panel" ? "panel" : "original";

export type Segment = "big" | "small" | "self_learn" | "details";
export type QField = "task" | "pain" | "business_type" | "use_case" | "format" | "slot" | "contact";
/** ช่องที่กำลังรอคำตอบ: ช่องข้อมูล หรือคำถามย่อยจากคำตอบพิเศษ */
export type Pending = QField | "it_team" | "workflow_task" | "think_reason";

export type Reply = { title: string; payload: string };
export interface OutPart {
  text: string;
  replies?: Reply[];
}

export interface QualDraft {
  flow: "qualifier";
  segment: Segment;
  button: string;
  revenueBand: string | null;
  fields: Partial<Record<QField, string>>;
  skipped: QField[];
  pending: Pending | null;
  retries: number;
  offTopic: number;
  priceAsked: number;
  priceShown: boolean;
  caseShown: boolean;
  caseKey: CaseKey | null;
  /** ลูกค้าถามหาตัวอย่างเองแต่ยังไม่รู้ธุรกิจ → ได้ธุรกิจแล้วต้องเล่าเคสให้จบก่อน */
  wantCase: boolean;
  meetingOffered: boolean;
  offeredSlots: string[];
  consentAt: string | null;
  questions: string[];
  recommended: string[];
}

// ── คำของต้น (สคริปต์) ───────────────────────────────────────────────────
export const SCRIPT = {
  smallOpen:
    "ขอบคุณครับ งานที่ปรึกษาของผมเริ่มที่ครึ่งวัน 14,000 บาท ถ้ายังอยากลองเองก่อน ผมมีคอร์สสอนเป็นกลุ่มด้วยครับ",
  selfOpen:
    "ได้เลยครับ ผมมีคอร์สสอนเป็นกลุ่ม ทั้งออนไลน์และที่ออฟฟิศ\n" +
    "สนใจใช้ AI กับงานแบบไหนครับ เช่น งานเอกสาร ทำคอนเทนต์ ทำแชตบอท หรือทำเว็บ",
  price:
    "ขึ้นอยู่กับว่าใครเป็นคนลงมือครับ\n" +
    "• ผมโค้ชให้ทีมคุณทำเอง: ครึ่งวัน 14,000 / เต็มวัน 22,000\n" +
    "• ผมทำระบบให้: ประเมินเป็นโปรเจกต์ หลังเห็นขอบเขตงาน\n" +
    "ส่วนใหญ่เริ่มจากครึ่งวันก่อน เพื่อวางว่าทำอะไรก่อนหลังครับ",
  thinkLater:
    "ได้ครับ ติดตรงไหนบอกผมได้นะครับ เรื่องงบ เวลา หรือยังไม่แน่ใจว่า AI ช่วยได้จริง ผมจะได้ส่งข้อมูลที่ตรงให้",
  expensive:
    "เริ่มจากเรื่องเดียวที่เจ็บที่สุดก่อนได้ครับ ครึ่งวันพอ ไม่ต้องทำทั้งระบบ เห็นผลแล้วค่อยตัดสินใจต่อ",
  hasIt: "ดีเลยครับ งานแบบนี้ผมโค้ชให้ทีม IT ทำเองได้ ระบบจะเป็นของทีมคุณเอง ไม่ต้องพึ่งผมตลอด",
  // ด่าน 4
  invite1:
    "จากที่เล่ามา ผมว่าคุยกันสัก 30 นาทีจะเห็นภาพเร็วกว่าพิมพ์ครับ\n" +
    "ผมจะดูให้ว่าเรื่องนี้ AI ช่วยได้จริงไหม และควรเริ่มตรงไหนถึงคุ้ม ถ้าไม่เหมาะผมบอกตรง ๆ",
} as const;

/** ด่าน 5 ฉบับวง persona (BOT-VOICE ข้อ 5 #8) — ใช้เมื่อ PRICE_COPY=panel เท่านั้น */
const PRICE_PANEL =
  "ขึ้นอยู่กับว่าใครเป็นคนลงมือครับ\n" +
  "• ผมโค้ชให้ทีมคุณทำเอง: ครึ่งวัน 14,000 / เต็มวัน 22,000\n" +
  "• ผมทำระบบให้: ราคาบอกได้หลังเห็นว่างานมีแค่ไหน ยังไม่เห็นงานผมไม่เดาตัวเลขให้\n" +
  "ส่วนใหญ่เริ่มจากครึ่งวันก่อน เพื่อวางว่าทำอะไรก่อนหลังครับ";

export function priceText(): string {
  return PRICE_COPY === "panel" ? PRICE_PANEL : SCRIPT.price;
}

/** คำของต้นในแชทจริงเรื่องคุยครั้งแรกไม่มีค่าใช้จ่าย (ต้นยืนยันแล้ว) */
export const FREE_CALL_LINE = "ขั้นตอนนี้ไม่มีค่าใช้จ่ายครับ";

// ── ถ้อยคำตาม BOT-VOICE (ข้อ 2.3 + 3.x) ───────────────────────────────────
export const VOICE = {
  taskQ: "ขอบคุณครับ ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ",
  taskQSmall: "ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ",
  typeOwn: 'พิมพ์มาได้เลยครับ สั้น ๆ ก็ได้ เช่น "ทำใบเสนอราคา" "ตามหนี้ลูกค้า"',
  pain: "ตรงไหนที่กินเวลาทีมมากที่สุดครับ",
  painDetailed: "ตอนนี้ทำงานนี้กันยังไงครับ ใช้ Excel ทำมือ หรือมีระบบอยู่แล้ว",
  businessType: "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ",
  useCase: "สนใจใช้ AI กับงานแบบไหนครับ เช่น งานเอกสาร ทำคอนเทนต์ ทำแชตบอท หรือทำเว็บ",
  consentConsult: "ขอเบอร์โทรหรือ LINE ไว้นัดคุยครับ ถ้ายังไม่อยากให้ก็บอกได้",
  consentSelf: "รอบเรียนที่เปิดอยู่ ให้ผมแจ้งทาง LINE หรือโทรดีครับ ถ้ายังไม่อยากให้ช่องทางก็บอกได้",
  consentConfirm: "ได้ครับ ใช้เรื่องนี้เรื่องเดียว อยากให้ลบเมื่อไรบอกได้เลย",
  contactRetry: "ขอเป็นเบอร์ 10 หลัก หรือ LINE ID ครับ",
  offTopic: "ได้ครับ",
  questionNoted: "ข้อนี้เดี๋ยวผมตอบเองในแชทนี้ครับ",
  selfIntro: "งานแบบนี้ เรียนคอร์สนี้ครับ",
  doneConsult: "ขอบคุณครับ เดี๋ยวผมทักกลับไปนัดเวลาคุยนะครับ",
  doneSelf: "ขอบคุณครับ เดี๋ยวผมส่งรอบเรียนที่เปิดอยู่ให้นะครับ",
  declinedContact: "ได้ครับ ไม่เป็นไร เดี๋ยวผมคุยต่อในแชทนี้ครับ",
  toHuman: "เรื่องนี้ผมตอบเองดีกว่าครับ เดี๋ยวเข้ามาคุยต่อในแชทนี้",
  appointmentNoSlot: "ได้เลยครับ เดี๋ยวผมเข้ามาเสนอเวลาในแชทนี้",
  negotiateTail: "เดี๋ยวผมเข้ามาคุยต่อในแชทนี้ครับ",
  priceDetail: "ราคาละเอียดต้องเห็นขอบเขตงานก่อนครับ เดี๋ยวผมเข้ามาคุยต่อในแชทนี้",
  // 3.2 ตัวอย่าง/อ้างอิง
  detailsUnknown:
    "ผลงานที่ผ่านมาอยู่ที่นี่ครับ tonpalearn.com/portfolio\nธุรกิจของคุณทำเกี่ยวกับอะไรครับ ผมเลือกเคสที่ใกล้ที่สุดมาเล่าให้",
  casePrivacy: "ชื่อลูกค้าผมไม่เปิดในแชทนะครับ ภาพรวมงานอื่นอยู่ที่ tonpalearn.com/portfolio",
  caseInviteSlotLead: "ถ้าอยากฟังว่าทำยังไง คุยกันสัก 30 นาทีครับ",
  oldCustomerContact: "เรื่องนี้ผมต้องถามลูกค้าก่อนครับ เดี๋ยวเข้ามาคุยต่อในแชทนี้",
  // 3.3 SI
  si1: "เป็นที่ปรึกษาเป็นหลักครับ ส่วนใหญ่ผมโค้ชให้ทีมคุณทำเอง ระบบจะเป็นของทีมคุณ ไม่ต้องพึ่งผมตลอด",
  si2:
    "ถ้าอยากให้ผมทำระบบให้ก็รับเป็นโปรเจกต์ครับ ราคาบอกได้หลังเห็นว่างานมีแค่ไหน ยังไม่เห็นงานผมไม่เดาตัวเลขให้\n" +
    "ตอนนี้ในบริษัทมีทีม IT ไหมครับ",
  noIt: "ไม่มีทีม IT ก็ได้ครับ ตอนคุยเราดูกันว่าส่วนไหนทีมคุณทำเองได้ ส่วนไหนต้องมีคนช่วยทำ",
  // 3.4 ภาพรวม
  overview:
    "ได้ครับ ปกติเป็นแบบนี้\n" +
    "1. คุยกัน 30 นาที ดูว่างานไหน AI ช่วยได้จริง ถ้าไม่เหมาะผมบอกตรง ๆ\n" +
    "2. ครึ่งวัน 14,000 วางว่าทำอะไรก่อนหลัง (เต็มวัน 22,000)\n" +
    "3. ทีมคุณทำเองโดยผมโค้ช หรือให้ผมทำระบบให้ ประเมินเป็นโปรเจกต์",
  overviewSlotLead: "เริ่มที่ข้อ 1 ก่อนได้ครับ",
  // 3.5 วิธีทำ workflow
  workflow1: "ได้ครับ ขอเป็นงานจริง 1 งานครับ งานไหนที่ทำซ้ำทุกวันแล้วอยากให้ AI ทำแทน",
  workflowApps: "ในคลาสจะได้ AI ที่ตั้งค่าให้รู้จักงานของคุณ และเชื่อมกับแอปที่ใช้ประจำ เช่น Mail, Calendar, Google Drive",
  format: "สะดวกเรียน Online หรือ Onsite ครับ",
  // 3.7 บอทหรือคน — ต้องตอบตรงเสมอ
  isBot: "ตอนนี้เป็นระบบตอบอัตโนมัติครับ เดี๋ยวผม (ต้น) เข้ามาตอบเองในแชทนี้",
  // 3.8 เวลานัด
  slotNone: "ได้ครับ สะดวกช่วงไหนบอกมาได้เลย เดี๋ยวผมดูให้",
} as const;

const SLOT_NONE_TITLE = "ไม่สะดวกทั้งคู่";

// ── ปุ่ม (quick reply · ≤20 ตัวอักษร) ─────────────────────────────────────
const qr = (titles: string[], prefix: string): Reply[] =>
  titles.map((t, i) => ({ title: t, payload: `${prefix}_${i + 1}` }));
export const OTHER_TITLE = "อื่น ๆ พิมพ์เอง";
export const TASK_BUTTONS = qr(
  ["ตอบแชท/ตามลูกค้า", "เอกสาร/จัดซื้อ/สต็อก", "สรุปตัวเลขผู้บริหาร", "งานในโรงงาน", OTHER_TITLE],
  "Q_TASK",
);
export const SELF_BUTTON_TITLE = "อยากเรียนเอง";
export const TASK_BUTTONS_SMALL = qr(
  ["ตอบแชท/ตามลูกค้า", "เอกสาร/จัดซื้อ/สต็อก", "ทำคอนเทนต์", SELF_BUTTON_TITLE, OTHER_TITLE],
  "Q_TASKS",
);
export const USECASE_BUTTONS = qr(["งานเอกสาร", "ทำคอนเทนต์", "ทำแชตบอท", "ทำเว็บ", OTHER_TITLE], "Q_USE");
export const IT_BUTTONS = qr(["มีทีม IT", "ไม่มี"], "Q_IT");
export const THINK_BUTTONS = qr(["เรื่องงบ", "เรื่องเวลา", "ไม่แน่ใจว่าช่วยได้"], "Q_THINK");
export const FORMAT_BUTTONS = qr(["Online", "Onsite"], "Q_FMT");

export function slotButtons(slots: string[]): Reply[] {
  return [...slots.map((s, i) => ({ title: s.slice(0, 20), payload: `Q_SLOT_${i + 1}` })), {
    title: SLOT_NONE_TITLE,
    payload: "Q_SLOT_NONE",
  }];
}

// ── 4 เคสในสคริปต์ด่าน 3 (คำต่อคำ ไม่ระบุชื่อ · โรงสียัง "กำลัง" ย้าย) ─────────────
export type CaseKey = "mill" | "group" | "insurance" | "agent";
export const CASES: Record<CaseKey, { label: string; text: string }> = {
  mill: { label: "โรงสี", text: "มีครับ ใกล้สุดคือโรงสีครับ งานที่เคยกรอกมือในระบบเก่าทุกเดือน กำลังย้ายขึ้นระบบใหม่ทีละส่วน" },
  group: {
    label: "กลุ่มบริษัท",
    text: "มีครับ ใกล้สุดคือกลุ่มบริษัทที่มีหลายบริษัทครับ เดิมรวมตัวเลขเงินจากหลายไฟล์ ตอนนี้ดูกระแสเงินสดทุกบริษัทได้ในหน้าเดียว",
  },
  insurance: { label: "บริษัทประกัน", text: "มีครับ ใกล้สุดคือบริษัทประกันครับ ย้ายระบบหลักไปตัวใหม่ โดยมี AI ช่วยไล่ตรวจข้อมูล" },
  agent: { label: "คลัง Agent กลาง", text: "มีครับ ทำให้หลายองค์กรแล้ว เป็นคลัง Agent กลาง ให้ทุกแผนกเรียกใช้ความรู้ชุดเดียวกัน" },
};
/** โรงงานคนละอุตสาหกรรมกับโรงสี → บอกตรง ๆ (BOT-VOICE 3.2 วงรอบ 2) */
const MILL_OTHER_INDUSTRY =
  "มีครับ ที่ใกล้สุดที่ผมมีตอนนี้คือโรงสี คนละอุตสาหกรรมกัน งานที่เคยกรอกมือในระบบเก่าทุกเดือน กำลังย้ายขึ้นระบบใหม่ทีละส่วน";

export function pickCase(business: string): { key: CaseKey; text: string } {
  const t = (business ?? "").toLowerCase();
  if (/โรงงาน|ผลิต|โรงสี|เกษตร|แปรรูป|คลังสินค้า|โกดัง|factory/.test(t)) {
    const same = /โรงสี|ข้าว/.test(t);
    return { key: "mill", text: same ? CASES.mill.text : MILL_OTHER_INDUSTRY };
  }
  if (/กลุ่มบริษัท|หลายบริษัท|หลายสาขา|บัญชี|การเงิน|กระแสเงินสด/.test(t)) return { key: "group", text: CASES.group.text };
  if (/ประกัน|ไฟแนนซ์|ธนาคาร|ย้ายระบบ|ระบบเก่า/.test(t)) return { key: "insurance", text: CASES.insurance.text };
  return { key: "agent", text: CASES.agent.text };
}

// ── ข้อความชวนนัด (มี/ไม่มีช่องเวลาว่าง) ─────────────────────────────────────
const freeLead = () => (FREE_FIRST_CALL ? `${FREE_CALL_LINE}\n` : "");
const twoSlots = (s: string[]) => `สะดวก ${s[0]} หรือ ${s[1]} ครับ โทรหรือ Zoom ก็ได้`;

/** ข้อความชวนนัดแบบยังไม่มีช่องเวลาว่าง: บรรทัดนำ + (ฟรี) + "เดี๋ยวผมเข้ามาเสนอเวลาในแชทนี้" */
export function inviteNoSlot(leadLine: string): string {
  return [leadLine, FREE_FIRST_CALL ? FREE_CALL_LINE : "", "เดี๋ยวผมเข้ามาเสนอเวลาในแชทนี้"].filter(Boolean).join("\n");
}

/** ด่าน 4 แบบมีช่องเวลา (เรียกเมื่อมีอย่างน้อย 2 ช่อง) */
export function inviteParts(slots: string[]): OutPart[] {
  return [{ text: SCRIPT.invite1 }, { text: `${freeLead()}${twoSlots(slots)}`, replies: slotButtons(slots) }];
}

// ── จับปุ่มยอดขาย/ข้อความแนวเดียวกัน ────────────────────────────────────────
export interface AdEntry {
  segment: Segment;
  button: string;
  revenueBand: string | null;
}

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

  const typed = c.match(/^(?:ยอดขาย|รายได้|ประมาณ)?(\d+(?:\.\d+)?)ล้าน(?:บาท)?(?:ครับ|ค่ะ|คะ|ต่อปี|\/ปี)*$/);
  if (typed) {
    const n = Number(typed[1]);
    return { segment: n < 10 ? "small" : "big", button, revenueBand: `ระบุเอง ${typed[1]} ล้าน` };
  }
  if (!/คอร์ส/.test(c) && isReferencesRequest(c)) return { segment: "details", button, revenueBand: null };
  return null;
}

function isReferencesRequest(c: string): boolean {
  return /ลูกค้าอ้างอิง|อ้างอิง|reference|ตัวอย่างโครงการ|ตัวอย่าง|ผลงาน|portfolio|พอร์ตโฟลิโอ|เคสจริง|กรณีศึกษา|เคยทำ.{0,20}(ไหม|มั้ย|หรือเปล่า|รึเปล่า)|(ขอ|ส่ง|อยากได้|มี).{0,6}(รายละเอียด|ราบละเอียด|ละเอียด)/.test(
    c,
  );
}

/** ข้อความแรกตามปุ่มที่กด (อาจหลายข้อความ) + ช่องที่รอ */
export function openingParts(entry: AdEntry): { parts: OutPart[]; pending: Pending } {
  switch (entry.segment) {
    case "big":
      return { parts: [{ text: VOICE.taskQ, replies: TASK_BUTTONS }], pending: "task" };
    case "small":
      return {
        parts: [{ text: SCRIPT.smallOpen }, { text: VOICE.taskQSmall, replies: TASK_BUTTONS_SMALL }],
        pending: "task",
      };
    case "self_learn":
      return { parts: [{ text: SCRIPT.selfOpen, replies: USECASE_BUTTONS }], pending: "use_case" };
    case "details":
      return { parts: [{ text: VOICE.detailsUnknown }], pending: "business_type" };
  }
}

export function newDraft(entry: AdEntry, pending: Pending): QualDraft {
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
    priceShown: false,
    caseShown: false,
    caseKey: null,
    wantCase: entry.segment === "details",
    meetingOffered: false,
    offeredSlots: [],
    consentAt: null,
    questions: [],
    recommended: [],
  };
}

export function isQualDraft(v: unknown): v is QualDraft {
  return Boolean(v && typeof v === "object" && (v as { flow?: unknown }).flow === "qualifier");
}

// ── ข้อความแทรก (จับด้วยโค้ด ก่อนเรียกโมเดล) ──────────────────────────────────
export type Interjection =
  | "is_bot"
  | "old_customer"
  | "decline"
  | "appointment"
  | "negotiate"
  | "price_detail"
  | "price"
  | "references"
  | "si"
  | "overview"
  | "workflow"
  | "think_later"
  | "has_it"
  | "tell_case";

/**
 * "คุยกับบอทหรือคน" — ระวังคำว่าบอทที่เป็นงาน (แชตบอท / LINE bot) ไม่นับ
 * และ "อยากให้ AI ตอบแชท" ไม่ใช่การถามว่าเป็นบอทไหม
 */
export function isBotQuestion(text: string): boolean {
  const t = normalize(text)
    .replace(/แชทบอท|แชตบอท|แชทบอต|แชตบอต|chat\s?bot|line\s?bot|ไลน์บอท|ทำบอท|สร้างบอท/g, "")
    .replace(/\s+/g, "");
  return (
    /(นี่|นี้|เป็น|ใช่)(ai|เอไอ|บอท|บอต|bot|ระบบ)/.test(t) ||
    /(ai|เอไอ|บอท|บอต|bot)(ตอบ)?(เหรอ|หรอ|รึเปล่า|หรือเปล่า|ป่าว|หรือคน|ใช่ไหม|ใช่มั้ย|ไหม|มั้ย|\?)/.test(t) ||
    /คุยกับ(บอท|บอต|bot|ai|เอไอ)|คนจริง|ตอบอัตโนมัติ|ระบบอัตโนมัติ|แอดมินจริง|ใช่คนไหม|เป็นคนไหม|isthisa?(bot|ai|human)|areyoua?(bot|human|real)/.test(
      t,
    )
  );
}

export function detectInterjection(text: string, pending: Pending | null): Interjection | null {
  const t = normalize(text);
  const c = t.replace(/\s+/g, "");
  if (isBotQuestion(text)) return "is_bot";
  if (/ติดต่อลูกค้าเก่า|ขอเบอร์ลูกค้า|คุยกับลูกค้า(เก่า|ที่เคยทำ)|ขอคุยกับลูกค้า/.test(c)) return "old_customer";

  const personal = pending === "contact";
  if (/ไม่ให้เบอร์|ไม่สะดวกให้|ขอไม่ให้|ไม่ขอให้|ขอไม่ตอบ|ไม่ขอตอบ|ไม่สะดวกบอก|ขอข้าม|ข้ามไป|ยังไม่อยากให้/.test(c)) return "decline";
  if (isDecline(t) && (personal || c.length <= 20)) return "decline";

  if (/ขอนัด|นัดคุย|นัดเวลา|นัดได้|อยากนัด|ว่างวันไหน|สะดวกวันไหน|ว่างกี่โมง|คุยทางzoom|zoomได้|ซูมได้|โทรคุย|โทรหาผม|โทรหาหน่อย|โทรกลับ|ขอเจอ|^คุย(ครับ|ค่ะ|คะ)?$|^สะดวกคุย/.test(c))
    return "appointment";
  if (/ลดได้ไหม|ลดได้มั้ย|ลดราคา|ส่วนลด|ต่อรอง|ถูกกว่านี้|ลดหน่อย|แพงไป|แพงจัง|แพงมาก|^แพง/.test(c)) return "negotiate";

  const priceWord = /ราคา|เท่าไร|เท่าไหร่|กี่บาท|ค่าใช้จ่าย|ค่าบริการ|ค่าเรียน|ค่าคอร์ส/.test(c);
  const asking = /เท่าไร|เท่าไหร่|กี่บาท|ไหม|มั้ย|ยังไง|อย่างไร|เริ่ม|ประมาณ|คิดยังไง|\?|ขอ/.test(c);
  if (/ใบเสนอราคา|quotation|ใบquote/.test(c)) return "price_detail";
  if (priceWord && asking) {
    if (/ทำระบบ|โปรเจกต์|โปรเจค|project|ทั้งระบบ|ราคาละเอียด|แยกรายการ/.test(c)) return "price_detail";
    return "price";
  }

  if (/^เล่าเลย/.test(c)) return "tell_case";
  if (
    /(^|[^a-z])si([^a-z]|$)/.test(t) ||
    /systemintegrator|ต่างจาก.{0,15}(ทำระบบ|softwarehouse|ซอฟต์แวร์เฮาส์)|บริษัททำระบบ|รับทำระบบ(ไหม|มั้ย|ด้วย)/.test(c)
  )
    return "si";
  if (/ภาพรวม|สรุป(ให้)?(ก่อน|คร่าว)|overview|ขั้นตอน(การทำงาน)?(เป็น)?(ยังไง|อย่างไร)|ทำงานกันยังไง/.test(c)) return "overview";
  if (/วิธีทำ|สอนวิธี|สอนทำ|อยากได้.{0,10}วิธี|(ขอ|อยากได้|สอน).{0,6}(workflow|เวิร์กโฟลว์|เวิร์คโฟลว์)/.test(c)) return "workflow";
  if (isReferencesRequest(c)) return "references";
  if (/ขอคิดดู|ขอคิดก่อน|เดี๋ยวคิดดู|ขอไปคิด|ขอเวลาคิด/.test(c)) return "think_later";
  if (pending !== "business_type" && pending !== "it_team" && /มี(ทีม)?(it|ไอที)(อยู่แล้ว)?|มีโปรแกรมเมอร์/.test(c))
    return "has_it";
  return null;
}

// ── สกัดค่าแบบไม่ใช้โมเดล ─────────────────────────────────────────────────
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
  if (!line && !phone && !email) {
    const solo = text.trim().match(/^@?[a-z][a-z0-9._-]{2,39}$/i);
    if (solo) line = solo[0];
  }
  return { phone, email, line };
}

export function contactToString(c: ContactInfo): string | null {
  const parts = [c.phone && `โทร ${c.phone}`, c.email && `อีเมล ${c.email}`, c.line && `LINE ${c.line}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const clip = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);
const tidy = (s: string, n = 300) =>
  clip(s, n + 20)
    .replace(/\s*(นะ)?(ครับผม|ครับ|ค่ะ|คะ|จ้า|จ้ะ)\s*$/u, "")
    .trim()
    .slice(0, n);

/** กติกาตายตัว: เอาคำตอบทั้งก้อนใส่ช่องที่กำลังถาม */
export function deterministicExtract(text: string, pending: Pending | null): Partial<Record<QField, string>> {
  if (pending === "task" || pending === "pain" || pending === "business_type" || pending === "use_case") {
    const v = tidy(text);
    return v ? { [pending]: v } : {};
  }
  return {};
}

/** ด่านกันโมเดลแต่ง: ห้ามมีตัวเลขเงิน/วันที่/เวลา หรือตัวเลขใด ๆ ที่ลูกค้าไม่ได้พิมพ์ · ห้ามรับช่องติดต่อจากโมเดล */
export function sanitizeExtracted(
  fields: Partial<Record<string, string>>,
  customerText: string,
): Partial<Record<QField, string>> {
  const allowed: QField[] = ["task", "pain", "business_type", "use_case"];
  const out: Partial<Record<QField, string>> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k as QField) || typeof v !== "string") continue;
    const val = clip(v);
    if (val === "") continue;
    if (findUnsupportedFacts(val, [customerText]).length > 0) continue;
    const nums = val.match(/\d[\d,]*/g) ?? [];
    if (nums.some((n) => !customerText.replace(/,/g, "").includes(n.replace(/,/g, "")))) continue;
    out[k as QField] = val;
  }
  return out;
}

export function looksLikeQuestion(text: string): boolean {
  const c = normalize(text).replace(/\s+/g, "");
  return /\?|ไหม(ครับ|คะ|ค่ะ)?$|มั้ย(ครับ|คะ|ค่ะ)?$|หรือเปล่า|รึเปล่า|ได้ไหม|ได้มั้ย|ยังไง(ครับ|คะ)?$|อย่างไร/.test(c);
}

/**
 * ข้อความนี้ใช้เป็น "ชื่อ" ได้ไหม (ใช้กับโฟลว์ชื่อ-เบอร์เดิมใน brain.ts)
 * บั๊กเดิม: "ผมอยากได้แบบวิธีทำเลย" ถูกเก็บเป็นชื่อ แล้วบอตขอเบอร์ต่อ
 */
export function isLikelyName(text: string): boolean {
  const t = text.trim();
  if (t === "" || t.length > 30) return false;
  if (looksLikeQuestion(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  return !/อยาก|ต้องการ|ช่วย|ทำ|วิธี|ราคา|เท่าไร|เท่าไหร่|สนใจ|คอร์ส|ไหม|มั้ย|ยังไง|ได้|เรียน|บอท|บอต|\d{3,}/.test(t.replace(/\s+/g, ""));
}

// ── คอร์ส (กลุ่มอยากเรียนเอง / วิธีทำ workflow) ─────────────────────────────
export function selfLearnRecommendation(useCase: string): { parts: OutPart[]; ids: string[] } {
  const picks = recommendCourses(useCase);
  return {
    parts: [{ text: `${VOICE.selfIntro}\n${picks.map(courseLine).join("\n")}` }],
    ids: picks.map((c) => c.id),
  };
}

/** 3.5 ข้อความที่ 2 (+ บรรทัดแอปถ้างานเกี่ยว) + ข้อความที่ 3 ถาม Online/Onsite */
export function workflowParts(task: string): { parts: OutPart[]; ids: string[] } {
  // ลูกค้าขอ "วิธีทำ workflow" = งานอัตโนมัติ → ถ้าไม่ได้จับคอร์สเฉพาะทาง (แชตบอท/เว็บ/คอนเทนต์ ฯลฯ) ให้ไป AI Agentic (02)
  const first = recommendCourses(task).find((c) => c.id !== "01") ?? courseById("02")!;
  const parts: OutPart[] = [{ text: `งานแบบนี้ อยู่ในคอร์ส ${first.name} ${first.hours} ชม. ครับ ในคลาสผมให้เอางานนี้มาทำด้วยกันเลย` }];
  if (first.id === "02" && /เมล|อีเมล|email|mail|ปฏิทิน|calendar|นัด|drive|ไดรฟ์|ไฟล์/i.test(task)) {
    parts.push({ text: VOICE.workflowApps });
  }
  parts.push({ text: VOICE.format, replies: FORMAT_BUTTONS });
  return { parts, ids: [first.id] };
}

export function selfLearnPrice(recommended: string[]): string {
  const list = (recommended.length ? recommended : ["01", "02"])
    .map((id) => courseById(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  return `ราคาครับ\n${list.map(coursePriceLine).join("\n")}`;
}

export function allowedMoneyFigures(): string[] {
  const fromScript = ["14000", "22000"];
  const fromMaster = Object.values(TIER_PRICES).flatMap((p) => (p ? [p.online, p.onsite, p.nextPerson].map(String) : []));
  return [...new Set([...fromScript, ...fromMaster])];
}

// ── ช่องเวลาว่าง (settings.meeting_slots — ต้นกรอกบรรทัดละ 1 ช่อง) ─────────────
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];

/**
 * หยิบ 2 ช่องแรกที่ยังไม่ผ่านไป · ช่องที่อ่านวันที่ไม่ออก หรือ "ชื่อวันไม่ตรงกับวันที่" ถูกข้าม
 * (กันบอตเสนอวันผิด — BOT-VOICE 3.8 เตือนให้ต้นเช็กวันในสัปดาห์)
 * คืน [] ถ้าได้ไม่ถึง 2 ช่อง → ทุกคำขอนัดส่งต่อต้น
 */
export function usableSlots(raw: string, now = new Date()): string[] {
  const lines = (raw ?? "")
    .split(/\n|,|;/)
    .map((l) => l.replace(/^[\s"'[\]-]+|[\s"'[\]]+$/g, "").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})?\D*?(\d{1,2})[:.](\d{2})/);
    if (!m) continue;
    const day = Number(m[1]);
    const month = TH_MONTHS.indexOf(m[2]);
    let year = m[3] ? Number(m[3]) : NaN;
    if (Number.isFinite(year)) {
      if (year < 100) year += 2500; // 69 → 2569
      if (year > 2400) year -= 543; // พ.ศ. → ค.ศ.
    }
    // เวลาไทย = UTC+7
    const bkkNow = new Date(now.getTime() + 7 * 3600_000);
    const y = Number.isFinite(year) ? year : bkkNow.getUTCFullYear();
    let at = Date.UTC(y, month, day, Number(m[4]) - 7, Number(m[5]));
    if (!Number.isFinite(year) && at < now.getTime() - 180 * 86400_000) at = Date.UTC(y + 1, month, day, Number(m[4]) - 7, Number(m[5]));
    if (at <= now.getTime()) continue;
    const weekday = new Date(at + 7 * 3600_000).getUTCDay();
    const named = TH_DAYS.findIndex((d) => line.includes(d));
    if (named >= 0 && named !== weekday) continue;
    out.push(line);
    if (out.length === 2) break;
  }
  return out.length === 2 ? out : [];
}

// ── สรุปให้ต้น + ร่างตามรอบ 2 ───────────────────────────────────────────────
export const FIELD_LABEL: Record<QField, string> = {
  task: "อยากให้ AI ช่วยงาน",
  pain: "ตรงไหนกินเวลา",
  business_type: "ธุรกิจ",
  use_case: "อยากใช้ AI กับงาน",
  format: "รูปแบบเรียน",
  slot: "เวลานัดที่เลือก",
  contact: "ติดต่อ",
};

const SEGMENT_LABEL: Record<Segment, string> = {
  big: "ธุรกิจ 10 ล้านขึ้นไป",
  small: "ธุรกิจต่ำกว่า 10 ล้าน",
  self_learn: "อยากเรียน AI เอง",
  details: "ขอรายละเอียด/ตัวอย่างงาน",
};

const SUMMARY_FIELDS: Record<Segment, QField[]> = {
  big: ["task", "pain", "business_type", "slot", "contact"],
  small: ["task", "pain", "business_type", "slot", "contact"],
  details: ["task", "pain", "business_type", "slot", "contact"],
  self_learn: ["use_case", "format", "contact"],
};

/**
 * ร่างข้อความตามรอบ 2 (วันที่ 3–5 · สคริปต์ด่าน 7) — **บอตห้ามส่งเอง** ต้นคัดลอกไปส่งใน Business Suite
 * [ปัญหา] ปล่อยไว้ให้ต้นแทนด้วยคำสั้น ๆ ของตัวเอง (บอตเรียบเรียงคำลูกค้าไม่ได้)
 */
export function roundTwoDraft(d: QualDraft): string {
  if (d.segment === "self_learn") {
    const name = courseById(d.recommended[0] ?? "")?.name;
    return name
      ? `ยังสนใจเรียน${name}อยู่ไหมครับ ถ้าตอนนี้ยังไม่ใช่จังหวะ บอกได้เลยนะครับ ผมจะไม่ทักซ้ำ`
      : "ยังสนใจเรียน[ชื่อคอร์ส]อยู่ไหมครับ ถ้าตอนนี้ยังไม่ใช่จังหวะ บอกได้เลยนะครับ ผมจะไม่ทักซ้ำ";
  }
  if (d.fields.pain || d.fields.task) {
    return "ยังสนใจเรื่อง[ปัญหา]อยู่ไหมครับ ถ้าตอนนี้ยังไม่ใช่จังหวะ บอกได้เลยนะครับ ผมจะไม่ทักซ้ำ";
  }
  return "ยังสนใจเอา AI มาช่วยงานในบริษัทอยู่ไหมครับ ถ้าตอนนี้ยังไม่ใช่จังหวะ บอกได้เลยนะครับ ผมจะไม่ทักซ้ำ";
}

export function buildSummary(
  d: QualDraft,
  reason: string,
  link: string | null,
  profileName: string | null,
  draft: string,
): string {
  const lines = [
    "ผู้สนใจใหม่จากแอด Messenger",
    `ชื่อในโปรไฟล์: ${profileName ?? "—"}`,
    `ปุ่มที่กด: ${d.button}`,
    `กลุ่ม: ${SEGMENT_LABEL[d.segment]}${d.revenueBand ? ` (${d.revenueBand})` : ""}`,
  ];
  for (const f of SUMMARY_FIELDS[d.segment]) {
    const v = d.fields[f];
    if (f === "slot" && !v) continue;
    lines.push(`${FIELD_LABEL[f]}: ${v ?? (d.skipped.includes(f) ? "(ไม่ตอบ)" : "—")}`);
  }
  if (d.caseKey) lines.push(`เคสที่บอตเล่า: ${CASES[d.caseKey].label}`);
  if (d.recommended.length) {
    lines.push(`คอร์สที่บอตแนะนำ: ${d.recommended.map((id) => COURSES.find((c) => c.id === id)?.name ?? id).join(", ")}`);
  }
  if (d.priceShown) lines.push("ลูกค้าเห็นราคาแล้ว");
  if (d.questions.length) lines.push(`ลูกค้าถามไว้ (ยังไม่มีคนตอบ): ${d.questions.join(" / ")}`);
  lines.push("ถามตอนคุย: ตัดสินใจเองไหม · อยากเห็นผลเมื่อไร");
  lines.push(`ส่งต่อเพราะ: ${reason}`);
  lines.push(`ร่างตามรอบ 2 (วันที่ 3–5 · ต้นส่งเอง ไม่เกิน 7 วันหลังข้อความล่าสุดของลูกค้า):\n${draft}`);
  if (link) lines.push(`ดูแชท: ${link}`);
  return lines.join("\n");
}
