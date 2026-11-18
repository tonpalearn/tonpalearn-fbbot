#!/usr/bin/env node
/**
 * ฐานข้อมูลปลอมสำหรับเปิดดู "หน้าแอดมิน" ในเครื่อง — ไม่แตะ Supabase / Facebook ของจริงเลย
 *
 * ต่างจาก smoke-local.mjs: ตัวนั้นยิงบทสนทนาเข้า webhook ทีละข้อความ (ทดสอบสมองบอต)
 * ตัวนี้ใส่ข้อมูลตัวอย่างครบทุกสถานะไว้ก่อนเลย (รอคน · ผู้สนใจใหม่ · ร่างรอบ 2 ใกล้หมดเวลา ฯลฯ)
 * และรองรับคำสั่งที่หน้าแอดมินใช้ (join contacts · in.() · count · not.is.null · kb_chunks(count))
 * ชื่อ เบอร์ อีเมล ทั้งหมดเป็นข้อมูลสมมติ ไม่ใช่ลูกค้าจริง
 *
 * วิธีใช้ (2 หน้าต่าง):
 *   หน้าต่าง 1:  node scripts/mock-admin.mjs            (--empty = ฐานว่าง ไว้ดูหน้าตอนยังไม่มีข้อมูล)
 *   หน้าต่าง 2:  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54391 \
 *                FB_GRAPH_BASE_URL=http://127.0.0.1:54391/graph \
 *                npm run dev
 *   แล้วเปิด http://localhost:3111/admin · รหัสผ่าน = ADMIN_PASSCODE ใน .env.local (ค่าปลอม)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const PAGE = process.env.FB_PAGE_ID ?? "PAGE_LOCAL";
const PORT = Number(process.env.MOCK_ADMIN_PORT ?? 54391);
const EMPTY = process.argv.includes("--empty");

const uuid = () => crypto.randomUUID();
const NOW = Date.now();
const minAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const hrAgo = (h) => minAgo(h * 60);
const dayAgo = (d) => minAgo(d * 1440);

// ═════════════════════════ ช่องเวลาว่าง: ชื่อวันตรงกับวันที่จริงเสมอ ═════════════════════════
const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function nextWeekday(target, time) {
  const bkk = new Date(NOW + 7 * 3600_000);
  for (let i = 1; i <= 14; i += 1) {
    const d = new Date(bkk.getTime() + i * 86400_000);
    if (d.getUTCDay() === target) return `${TH_DAYS[target]} ${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${time}`;
  }
  return "";
}
const SLOT_A = nextWeekday(5, "14:00"); // ศุกร์ถัดไป
const SLOT_B = nextWeekday(2, "10:00"); // อังคารถัดไป

// ═════════════════════════ ข้อมูลตัวอย่าง ═════════════════════════
const db = {
  fb_pages: [{ id: uuid(), page_id: PAGE, page_name: "TONPALEARN", is_active: true, bot_enabled: true }],
  settings: [
    { key: "greeting", value: { text: "สวัสดีครับ ยินดีต้อนรับสู่ TONPALEARN อยากให้ช่วยเรื่องไหนดีครับ" } },
    { key: "fallback", value: { text: "ขอโทษครับ เรื่องนี้ผมขอเช็กก่อน เดี๋ยวผมเข้ามาตอบเองในแชทนี้ครับ" } },
    { key: "handoff_notice", value: { text: "เดี๋ยวผม (ต้น) เข้ามาคุยต่อเองในแชทนี้ครับ ระหว่างรอพิมพ์ทิ้งไว้ได้เลย" } },
    { key: "consent_notice", value: { text: "ขอเบอร์โทรหรือ LINE ไว้นัดคุยครับ ใช้เรื่องนี้เรื่องเดียว อยากให้ลบเมื่อไรบอกได้เลย" } },
    { key: "office_hours", value: { text: "จันทร์–ศุกร์ 9:00–18:00" } },
    { key: "bot_persona", value: { text: "พูดแทนต้นด้วยเสียง \"ผม\" สุภาพ กระชับ ไม่สัญญาผล ไม่แต่งตัวเลข" } },
    { key: "meeting_slots", value: { text: `${SLOT_A}\n${SLOT_B}` } },
  ],
  contacts: [],
  conversations: [],
  messages: [],
  leads: [],
  usage_log: [],
  webhook_events: [],
  handoff_events: [],
  faq_entries: [],
  rules: [],
  kb_documents: [],
  kb_chunks: [],
};

function addConvo({ first, last, state, unread = false, lastUser, draft = null, msgs = [] }) {
  const contact = { id: uuid(), page_id: PAGE, psid: `mock_${uuid().slice(0, 8)}`, first_name: first, last_name: last, profile_pic: null };
  db.contacts.push(contact);
  const convo = {
    id: uuid(),
    page_id: PAGE,
    contact_id: contact.id,
    state,
    unread_for_admin: unread,
    last_user_message_at: lastUser,
    updated_at: lastUser,
    created_at: lastUser,
    followup_draft: draft,
    followup_draft_at: draft ? lastUser : null,
    followup_sent_at: null,
    followup_variant: null,
  };
  db.conversations.push(convo);
  for (const [sender, content, source, at] of msgs) {
    db.messages.push({
      id: uuid(),
      page_id: PAGE,
      conversation_id: convo.id,
      direction: sender === "user" ? "in" : "out",
      sender,
      content,
      answer_source: source ?? null,
      confidence: null,
      created_at: at,
    });
    if (at > convo.updated_at) convo.updated_at = at;
  }
  return convo;
}

function addLead(convo, l) {
  db.leads.push({
    id: uuid(),
    page_id: PAGE,
    conversation_id: convo?.id ?? null,
    contact_id: convo?.contact_id ?? null,
    phone: null,
    email: null,
    line_id: null,
    note: null,
    consent_at: l.created_at,
    source: "messenger_ad",
    lead_type: l.segment === "self_learn" ? "individual" : "corporate",
    status: "new",
    ...l,
  });
}

const DRAFT = (pain) =>
  `สวัสดีครับ ยังอยากให้ AI ช่วยเรื่อง${pain}อยู่ไหมครับ ถ้าตอนนี้ยังไม่ใช่จังหวะ บอกได้เลยนะครับ ผมจะไม่ทักซ้ำ`;

if (!EMPTY) {
  // 1 · รอคน · ผู้สนใจใหม่จากแอด 100 ล้านขึ้นไป · มีร่างรอบ 2
  const c1 = addConvo({
    first: "ธนพล",
    last: "วงศ์ไพศาล",
    state: "awaiting_human",
    unread: true,
    lastUser: minAgo(25),
    draft: DRAFT("รวมยอดขายจากหลายสาขาทุกเช้า"),
    msgs: [
      ["user", "100 ล้านขึ้นไป", null, minAgo(34)],
      ["bot", "ขอบคุณครับ ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ", "qualifier:start", minAgo(34)],
      ["user", "สรุปตัวเลขผู้บริหาร", null, minAgo(33)],
      ["bot", "ตอนนี้ทำงานนี้กันยังไงครับ ตรงไหนกินเวลาที่สุด", "qualifier:pain", minAgo(33)],
      ["user", "ต้องรวมยอดขายจากหลายสาขาทุกเช้า ใช้คน 2 คนครึ่งวัน", null, minAgo(31)],
      ["bot", "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ ผมเลือกเคสที่ใกล้ที่สุดมาเล่าให้", "qualifier:business", minAgo(31)],
      ["user", "กลุ่มบริษัทค้าปลีก 4 บริษัท", null, minAgo(29)],
      ["bot", `คุยครั้งแรก 30 นาที ขั้นตอนนี้ไม่มีค่าใช้จ่ายครับ สะดวก ${SLOT_A} หรือ ${SLOT_B} ครับ`, "qualifier:offer", minAgo(29)],
      ["user", SLOT_B, null, minAgo(27)],
      ["bot", "ขอเบอร์โทรหรือ LINE ไว้นัดคุยครับ", "qualifier:contact", minAgo(27)],
      ["user", "089-555-0142", null, minAgo(25)],
      ["bot", `${SLOT_B} นะครับ เดี๋ยวผมส่งลิงก์ Zoom ให้ในแชทนี้`, "qualifier:done", minAgo(25)],
      ["system", "สรุปผู้สนใจ: ธนพล · กด 100 ล้านขึ้นไป · สรุปตัวเลขผู้บริหาร · เลือกเวลา " + SLOT_B, "lead_summary", minAgo(25)],
    ],
  });
  addLead(c1, {
    name: "ธนพล วงศ์ไพศาล",
    phone: "089-555-0142",
    interest: "ต้องรวมยอดขายจากหลายสาขาทุกเช้า ใช้คน 2 คนครึ่งวัน",
    segment: "big",
    created_at: minAgo(25),
    qualification: {
      button: "100 ล้านขึ้นไป",
      fields: { task: "สรุปตัวเลขผู้บริหาร", pain: "ต้องรวมยอดขายจากหลายสาขาทุกเช้า ใช้คน 2 คนครึ่งวัน", business_type: "กลุ่มบริษัทค้าปลีก 4 บริษัท", slot: SLOT_B, contact: "089-555-0142" },
      reason: `ได้ข้อมูลครบ · เลือกเวลา ${SLOT_B}`,
    },
  });

  // 2 · รอคน · โรงงาน ถาม SI
  const c2 = addConvo({
    first: "ปวีณา",
    last: "สุขเจริญ",
    state: "awaiting_human",
    unread: true,
    lastUser: hrAgo(3.2),
    msgs: [
      ["user", "10–100 ล้าน", null, hrAgo(3.6)],
      ["bot", "ขอบคุณครับ ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ", "qualifier:start", hrAgo(3.6)],
      ["user", "งานในโรงงาน", null, hrAgo(3.5)],
      ["bot", "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ", "qualifier:business", hrAgo(3.5)],
      ["user", "โรงงานฉีดพลาสติก ส่งชิ้นส่วนให้ค่ายรถ", null, hrAgo(3.3)],
      ["user", "ต่างจากบริษัททำระบบ SI ยังไงคะ", null, hrAgo(3.2)],
      ["bot", "เรื่องนี้เดี๋ยวผม (ต้น) เข้ามาตอบเองในแชทนี้ครับ", "handoff", hrAgo(3.2)],
    ],
  });
  addLead(c2, {
    name: "ปวีณา สุขเจริญ",
    line_id: "pavee.factory",
    interest: "งานในโรงงาน",
    segment: "big",
    created_at: hrAgo(3.2),
    qualification: {
      button: "10–100 ล้าน",
      fields: { task: "งานในโรงงาน", business_type: "โรงงานฉีดพลาสติก ส่งชิ้นส่วนให้ค่ายรถ", contact: "LINE pavee.factory" },
      reason: "ถามเรื่อง SI — ต้องให้คนตอบ",
    },
  });

  // 3 · รอคน เกิน 24 ชม. แล้ว (ส่งข้อความธรรมดาไม่ได้)
  addConvo({
    first: "กิตติศักดิ์",
    last: "แสงทอง",
    state: "awaiting_human",
    unread: false,
    lastUser: hrAgo(27),
    draft: DRAFT("ตอบแชทลูกค้า"),
    msgs: [
      ["user", "100 ล้านขึ้นไป", null, hrAgo(27.2)],
      ["bot", "ขอบคุณครับ ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ", "qualifier:start", hrAgo(27.2)],
      ["user", "นี่บอทตอบเหรอครับ", null, hrAgo(27)],
      ["bot", "ตอนนี้เป็นระบบตอบอัตโนมัติครับ เดี๋ยวผม (ต้น) เข้ามาตอบเองในแชทนี้", "handoff", hrAgo(27)],
    ],
  });

  // 4 · ต้นถือสายอยู่ ลูกค้าเพิ่งตอบกลับ
  addConvo({
    first: "อรอุมา",
    last: "ทองดี",
    state: "human_active",
    unread: true,
    lastUser: minAgo(40),
    msgs: [
      ["user", "สนใจคอร์ส AI Agentic ค่ะ มีรอบไหนบ้าง", null, hrAgo(5)],
      ["admin", "รอบถัดไปเป็น Online ครับ เดี๋ยวผมส่งรายละเอียดให้นะครับ", "admin", hrAgo(4.5)],
      ["user", "ได้ค่ะ ขอใบเสนอราคาสำหรับ 3 คนด้วยนะคะ", null, minAgo(40)],
    ],
  });

  // 5 · ต้นถือสายอยู่ ตอบไปแล้ว (ไม่ใช่งานวันนี้)
  addConvo({
    first: "ณัฐวุฒิ",
    last: "พรหมมา",
    state: "human_active",
    lastUser: hrAgo(6),
    msgs: [
      ["user", "ขอคุยกับแอดมินครับ", null, hrAgo(6.2)],
      ["bot", "เดี๋ยวผม (ต้น) เข้ามาคุยต่อเองในแชทนี้ครับ", "rule:ขอคุยกับคน", hrAgo(6.2)],
      ["user", "อยากให้ไปสอนที่บริษัทครับ", null, hrAgo(6)],
      ["admin", "ได้ครับ ขอจำนวนคนกับช่วงวันที่สะดวกหน่อยครับ", "admin", hrAgo(5.8)],
    ],
  });

  // 6 · บอตกำลังเก็บข้อมูล
  addConvo({
    first: "ศิริพร",
    last: "แก้วมณี",
    state: "collecting_lead",
    lastUser: minAgo(8),
    msgs: [
      ["user", "ต่ำกว่า 10 ล้าน", null, minAgo(9)],
      ["bot", "คอร์สเริ่มที่ 14,000 บาทครับ ตอนนี้อยากให้ AI ช่วยงานไหนก่อนครับ", "qualifier:start", minAgo(9)],
      ["user", "ทำคอนเทนต์", null, minAgo(8)],
      ["bot", "ตรงไหนกินเวลาที่สุดครับ", "qualifier:pain", minAgo(8)],
    ],
  });

  // 7 · บอตตอบจาก FAQ
  addConvo({
    first: "วรเชษฐ์",
    last: "นาคสวัสดิ์",
    state: "bot_active",
    lastUser: hrAgo(2),
    msgs: [
      ["user", "คอร์สมีอัดวิดีโอไหมครับ", null, hrAgo(2)],
      ["bot", "มีครับ คอร์ส AI Basic แบบวิดีโอ 990 บาท ดูย้อนหลังได้", "faq", hrAgo(2)],
    ],
  });

  // 8 · ปิดแล้ว
  addConvo({
    first: "ชุติมา",
    last: "บุญยืน",
    state: "closed",
    lastUser: dayAgo(4),
    msgs: [
      ["user", "ไม่สนใจแล้วค่ะ ขอบคุณ", null, dayAgo(4)],
      ["bot", "ได้ครับ ขอบคุณที่แวะเข้ามานะครับ", "rule:ไม่สนใจ", dayAgo(4)],
    ],
  });

  // 9–12 · ร่างรอบ 2 ที่ต้นต้องส่งเอง (กำหนด = 7 วันหลังข้อความล่าสุดของลูกค้า)
  const c9 = addConvo({
    first: "ภาณุวัฒน์",
    last: "ศรีวงศ์",
    state: "bot_active",
    lastUser: dayAgo(6.2),
    draft: DRAFT("ตามลูกค้าที่ขอใบเสนอราคา"),
    msgs: [
      ["user", "ตอบแชท/ตามลูกค้า", null, dayAgo(6.2)],
      ["bot", "ตอนนี้ทำงานนี้กันยังไงครับ", "qualifier:pain", dayAgo(6.2)],
      ["bot", "เล่าให้ฟังสั้น ๆ ก็ได้ครับ ถ้าสะดวกพิมพ์ว่า เล่าเลย", "followup:kho_case", dayAgo(6)],
    ],
  });
  addLead(c9, { name: "ภาณุวัฒน์ ศรีวงศ์", status: "contacted", segment: "small", created_at: dayAgo(6.2), interest: "ตอบแชท/ตามลูกค้า", qualification: { button: "ต่ำกว่า 10 ล้าน", fields: { task: "ตอบแชท/ตามลูกค้า" } } });
  addConvo({
    first: "มณีรัตน์",
    last: "ชัยมงคล",
    state: "collecting_lead",
    lastUser: dayAgo(5.6),
    draft: DRAFT("ทำเอกสารจัดซื้อ"),
    msgs: [
      ["user", "เอกสาร/จัดซื้อ/สต็อก", null, dayAgo(5.6)],
      ["bot", "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ", "qualifier:business", dayAgo(5.6)],
    ],
  });
  addConvo({
    first: "สมชาย",
    last: "รุ่งเรืองกิจ",
    state: "bot_active",
    lastUser: dayAgo(2.4),
    draft: DRAFT("สรุปรายงานประจำวัน"),
    msgs: [
      ["user", "สรุปตัวเลขผู้บริหาร", null, dayAgo(2.4)],
      ["bot", "ตรงไหนกินเวลาที่สุดครับ", "qualifier:pain", dayAgo(2.4)],
    ],
  });
  addConvo({
    first: "จันทร์เพ็ญ",
    last: "อินทร์แก้ว",
    state: "bot_active",
    lastUser: dayAgo(9),
    draft: DRAFT("ทำคอนเทนต์"),
    msgs: [["user", "ทำคอนเทนต์", null, dayAgo(9)]],
  });

  // 13 · ผู้สนใจใหม่ อยากเรียนเอง (ห้องไม่ได้รอคน)
  const c13 = addConvo({
    first: "ชยพล",
    last: "มั่นคง",
    state: "bot_active",
    lastUser: hrAgo(5),
    msgs: [
      ["user", "อยากเรียนเอง", null, hrAgo(5.3)],
      ["bot", "อยากใช้ AI กับงานไหนครับ", "qualifier:self", hrAgo(5.3)],
      ["user", "ทำแชตบอทตอบลูกค้าในร้าน", null, hrAgo(5.1)],
      ["bot", "แนะนำคอร์ส LINE ChatBot (4 ชม.) ครับ ขอช่องทางไว้แจ้งรอบเรียนครับ", "qualifier:course", hrAgo(5.1)],
      ["user", "chayapol@example.com", null, hrAgo(5)],
      ["bot", "ขอบคุณครับ เดี๋ยวผมแจ้งรอบเรียนให้ทางนี้ครับ", "qualifier:done", hrAgo(5)],
    ],
  });
  addLead(c13, {
    name: "ชยพล มั่นคง",
    email: "chayapol@example.com",
    interest: "ทำแชตบอทตอบลูกค้าในร้าน",
    segment: "self_learn",
    created_at: hrAgo(5),
    qualification: { button: "อยากเรียนเอง", fields: { use_case: "ทำแชตบอทตอบลูกค้าในร้าน", format: "Online", contact: "chayapol@example.com" }, reason: "อยากเรียนเอง · แนะนำคอร์ส 04" },
  });

  // 14 · ผู้สนใจใหม่ ขอตัวอย่างงาน (เมื่อวาน)
  const c14 = addConvo({
    first: "พิมพ์ชนก",
    last: "ราชสีห์",
    state: "bot_active",
    lastUser: dayAgo(1.1),
    msgs: [
      ["user", "ขอรายละเอียด", null, dayAgo(1.2)],
      ["bot", "ธุรกิจของคุณทำเกี่ยวกับอะไรครับ ผมเลือกเคสที่ใกล้ที่สุดมาเล่าให้", "qualifier:details", dayAgo(1.2)],
      ["user", "คลินิกความงาม 2 สาขา", null, dayAgo(1.1)],
    ],
  });
  addLead(c14, {
    name: "พิมพ์ชนก ราชสีห์",
    phone: "02-555-0178",
    line_id: "pimchanok.clinic",
    interest: "ตอบแชทลูกค้าคลินิก",
    segment: "details",
    created_at: dayAgo(1.1),
    qualification: { button: "ขอรายละเอียด", fields: { business_type: "คลินิกความงาม 2 สาขา", pain: "ตอบแชทลูกค้าคลินิกไม่ทัน" }, reason: "ขอตัวอย่างงาน" },
  });

  // ผู้สนใจเก่า (ไว้ดูหน้าผู้สนใจ + ตัวกรองวันที่)
  const older = [
    ["วีรยุทธ ศักดิ์ดี", "won", "big", 9, { button: "100 ล้านขึ้นไป", fields: { task: "เอกสาร/จัดซื้อ/สต็อก", business_type: "ผู้ผลิตอาหารแช่แข็ง" } }, "089-555-0111"],
    ["กัญญารัตน์ เพชรรัตน์", "contacted", "small", 12, { button: "ต่ำกว่า 10 ล้าน", fields: { task: "ทำคอนเทนต์", business_type: "ร้านเสื้อผ้าออนไลน์" } }, null],
    ["อนุชา ทรัพย์มาก", "lost", "big", 15, { button: "10–100 ล้าน", fields: { task: "ตอบแชท/ตามลูกค้า", business_type: "ตัวแทนประกัน" }, reason: "ขอคิดก่อน · เรื่องงบ" }, "089-555-0123"],
    ["ดวงใจ มีชัย", "won", "self_learn", 20, { button: "อยากเรียนเอง", fields: { use_case: "ทำเว็บ", format: "Onsite" } }, null],
  ];
  for (const [name, status, segment, d, qualification, phone] of older) {
    addLead(null, { name, status, segment, created_at: dayAgo(d), phone, email: phone ? null : `${segment}.${d}@example.com`, interest: qualification.fields.task ?? qualification.fields.use_case, qualification });
  }

  // FAQ · กติกา · ฐานความรู้
  db.faq_entries.push(
    { id: uuid(), page_id: PAGE, question: "คอร์สมีแบบอัดวิดีโอไหม", answer: "มีครับ คอร์ส AI Basic แบบวิดีโอ 990 บาท ดูย้อนหลังได้", keywords: ["วิดีโอ", "อัด", "ดูย้อนหลัง"], is_active: true, hit_count: 18, updated_at: dayAgo(3) },
    { id: uuid(), page_id: PAGE, question: "สอนที่บริษัทได้ไหม", answer: "ได้ครับ แบบ On-site คิดราคาตามจำนวนคน เดี๋ยวผมเข้ามาคุยรายละเอียดให้ครับ", keywords: ["สอนที่บริษัท", "onsite", "อบรมพนักงาน"], is_active: true, hit_count: 9, updated_at: dayAgo(5) },
    { id: uuid(), page_id: PAGE, question: "มีใบเสร็จ/ใบกำกับภาษีไหม", answer: "[กรอกเอง] ระบุเงื่อนไขออกใบกำกับภาษี", keywords: ["ใบเสร็จ", "ใบกำกับ", "vat"], is_active: true, hit_count: 2, updated_at: dayAgo(7) },
    { id: uuid(), page_id: PAGE, question: "เรียนที่ไหน", answer: "[กรอกเอง] ระบุสถานที่เรียนแบบกลุ่มเล็ก", keywords: ["ที่ไหน", "สถานที่"], is_active: false, hit_count: 0, updated_at: dayAgo(7) },
  );
  db.rules.push(
    { id: uuid(), page_id: PAGE, name: "ไม่สนใจ", match_type: "regex", pattern: "(ไม่สนใจ|ไม่เอา|ไม่ต้องการ)", action: "reply", reply_text: "ได้ครับ ขอบคุณที่แวะเข้ามานะครับ ถ้าสนใจเมื่อไรทักมาได้เลยครับ", quick_replies: null, priority: 5, is_active: true, hit_count: 4 },
    { id: uuid(), page_id: PAGE, name: "ขอคุยกับคน", match_type: "regex", pattern: "(คุยกับคน|คุยกับแอดมิน|ขอแอดมิน)", action: "handoff", reply_text: null, quick_replies: null, priority: 10, is_active: true, hit_count: 11 },
    { id: uuid(), page_id: PAGE, name: "สนใจสมัคร", match_type: "contains", pattern: "สนใจ", action: "collect_lead", reply_text: null, quick_replies: null, priority: 20, is_active: true, hit_count: 23 },
    { id: uuid(), page_id: PAGE, name: "ขอเมนู", match_type: "exact", pattern: "เมนู", action: "menu", reply_text: null, quick_replies: null, priority: 30, is_active: false, hit_count: 0 },
  );
  const doc = (title, source, n, active = true, d = 10) => {
    const id = uuid();
    db.kb_documents.push({ id, page_id: PAGE, title, source, is_active: active, created_at: dayAgo(d) });
    for (let i = 0; i < n; i += 1) db.kb_chunks.push({ id: uuid(), document_id: id, content: `ท่อนที่ ${i + 1}` });
  };
  doc("รายละเอียดคอร์สทั้ง 12 คอร์ส (MASTER)", "AI Course/MASTER.yaml", 14, true, 6);
  doc("เคสลูกค้า 4 เคสที่เล่าได้", "สคริปต์ด่าน 3", 5, true, 9);
  doc("นโยบายคืนเงิน (ร่างเก่า)", null, 2, false, 30);

  // ตัวเลขวันนี้
  for (let i = 0; i < 37; i += 1) db.usage_log.push({ id: uuid(), page_id: PAGE, created_at: minAgo(5 + i * 9) });
}

// ═════════════════════════ PostgREST ปลอม (เท่าที่หน้าแอดมินใช้) ═════════════════════════
const UNIQUE = { settings: ["key"], fb_pages: ["page_id"] };

/** แยก select ระดับบนสุด โดยไม่ตัดในวงเล็บ เช่น "id,contact:contacts(first_name,psid),kb_chunks(count)" */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(table, row, select) {
  if (!select || select === "*") return { ...row };
  const out = {};
  for (const part of splitTop(select)) {
    const m = part.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
    if (!m) {
      out[part] = row[part] ?? null;
      continue;
    }
    const [, alias, rel, inner] = m;
    const key = alias ?? rel;
    const fk = `${rel.replace(/s$/, "")}_id`;
    if (row[fk] !== undefined) {
      // หลายต่อหนึ่ง: conversations.contact_id → contacts
      const hit = db[rel]?.find((r) => r.id === row[fk]);
      out[key] = hit ? project(rel, hit, inner) : null;
    } else {
      // หนึ่งต่อหลาย: kb_documents → kb_chunks(document_id)
      const back = `${table.replace(/s$/, "").replace(/^kb_/, "")}_id`;
      const kids = (db[rel] ?? []).filter((r) => r[back] === row.id);
      out[key] = inner.trim() === "count" ? [{ count: kids.length }] : kids.map((k) => project(rel, k, inner));
    }
  }
  return out;
}

function parseIn(val) {
  const body = val.replace(/^\(|\)$/g, "");
  return splitTop(body).map((v) => v.replace(/^"|"$/g, ""));
}

function matches(row, col, expr) {
  let not = false;
  let e = expr;
  if (e.startsWith("not.")) {
    not = true;
    e = e.slice(4);
  }
  const dot = e.indexOf(".");
  const op = e.slice(0, dot);
  const val = decodeURIComponent(e.slice(dot + 1));
  const v = row[col];
  let ok;
  if (op === "is") ok = val === "null" ? v === null || v === undefined : String(v) === val;
  else if (op === "eq") ok = String(v) === val;
  else if (op === "neq") ok = String(v) !== val;
  else if (op === "gte") ok = v !== null && String(v) >= val;
  else if (op === "lte") ok = v !== null && String(v) <= val;
  else if (op === "gt") ok = v !== null && String(v) > val;
  else if (op === "lt") ok = v !== null && String(v) < val;
  else if (op === "in") ok = parseIn(val).includes(String(v));
  else ok = true;
  return not ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function rest(req, res, url, body) {
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  const [, , , table] = url.pathname.split("/");
  if (table === "rpc") return send(200, []);
  if (!db[table]) return send(404, { code: "42P01", message: `relation ${table} does not exist` });

  const filters = [...url.searchParams].filter(([k]) => !RESERVED.has(k));
  const pick = () => db[table].filter((r) => filters.every(([k, v]) => matches(r, k, v)));
  const prefer = req.headers["prefer"] ?? "";
  const wantObject = (req.headers["accept"] ?? "").includes("vnd.pgrst.object");
  const select = url.searchParams.get("select");

  const finish = (rows, status = 200, total) => {
    const data = rows.map((r) => project(table, r, select));
    const headers = total !== undefined ? { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/${total}` } : {};
    if (wantObject) {
      if (data.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(status, data[0], headers);
    }
    return send(status, data, headers);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = pick();
    const total = rows.length;
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) => {
        const x = a[col] ?? "";
        const y = b[col] ?? "";
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
        return dir === "desc" ? -c : c;
      });
    }
    const limit = Number(url.searchParams.get("limit") ?? 0);
    if (limit) rows = rows.slice(0, limit);
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Range": `*/${total}` });
      return res.end();
    }
    return finish(rows, 200, prefer.includes("count=") ? total : undefined);
  }

  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of items) {
      const keyCols = UNIQUE[table];
      const dup = keyCols ? db[table].find((r) => keyCols.every((c) => r[c] === item[c])) : null;
      if (dup && prefer.includes("resolution=merge-duplicates")) {
        Object.assign(dup, item);
        out.push(dup);
        continue;
      }
      const row = { id: uuid(), page_id: PAGE, created_at: new Date().toISOString(), hit_count: 0, is_active: true, ...item };
      db[table].push(row);
      out.push(row);
    }
    if (table === "kb_documents") {
      // ตัดท่อนจริงทำในโค้ดเซิร์ฟเวอร์ (insert kb_chunks ตามมา) — ไม่ต้องทำอะไรเพิ่ม
    }
    return prefer.includes("return=representation") ? finish(out, 201) : send(201);
  }

  if (req.method === "PATCH") {
    const rows = pick();
    for (const r of rows) Object.assign(r, body);
    return prefer.includes("return=representation") ? finish(rows) : send(204);
  }

  if (req.method === "DELETE") {
    const rows = pick();
    db[table] = db[table].filter((r) => !rows.includes(r));
    return prefer.includes("return=representation") ? finish(rows) : send(204);
  }
  return send(405, { message: "method not supported by fake" });
}

// Facebook ปลอม — ไว้ให้ปุ่ม "ส่งข้อความ" ในหน้าแชทกดได้ (ข้อความไม่ออกไปไหน)
function graph(req, res, url, body) {
  res.writeHead(200, { "Content-Type": "application/json" });
  if (req.method === "POST" && url.pathname.endsWith("/messages")) {
    console.log(`[graph ปลอม] ส่งถึง ${body.recipient?.id}: ${body.message?.text ?? "(action)"}`);
    return res.end(JSON.stringify({ recipient_id: body.recipient?.id, message_id: `m_${uuid()}` }));
  }
  return res.end(JSON.stringify({ success: true }));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}
    if (url.pathname.startsWith("/rest/v1/")) return rest(req, res, url, body);
    if (url.pathname.startsWith("/graph/")) return graph(req, res, url, body);
    res.writeHead(404);
    res.end();
  });
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`ฐานปลอมหน้าแอดมิน พร้อมที่ http://127.0.0.1:${PORT} ${EMPTY ? "(ฐานว่าง)" : `· ${db.conversations.length} ห้อง · ${db.leads.length} ผู้สนใจ`}`);
  console.log(`ช่องเวลาว่างตัวอย่าง: ${SLOT_A} · ${SLOT_B}`);
});
