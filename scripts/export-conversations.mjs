#!/usr/bin/env node
/**
 * ดึงประวัติแชท Messenger ทั้งหมดของเพจ (รวมข้อความที่คนตอบใน Business Suite ซึ่งไม่อยู่ในฐานของบอต)
 *
 *   node scripts/export-conversations.mjs
 *   node scripts/export-conversations.mjs --since 2026-11-08      # เอาเฉพาะห้องที่อัปเดตตั้งแต่วันนี้
 *   node scripts/export-conversations.mjs --from-json exports/conversations-X.json
 *        # ไม่เรียก API · สร้าง CSV ใหม่จาก JSON ที่มีอยู่ (เขียนทับ .csv ชื่อเดียวกัน) — ใช้แก้ไฟล์เก่าที่ชื่อรั่ว
 *
 * อ่านค่าจากไฟล์ .env.export (ห้าม commit — อยู่ใน .gitignore แล้ว):
 *   FB_EXPORT_PAGE_TOKEN=   Page Access Token ที่มีสิทธิ์ pages_messaging (+ pages_read_engagement)
 *   FB_PAGE_ID=
 *   GRAPH_API_VERSION=v21.0
 *
 * ผลลัพธ์ในโฟลเดอร์ exports/ (ห้าม commit — มีข้อมูลลูกค้า):
 *   conversations-<เวลา>.json       ข้อมูลดิบครบ (มีชื่อลูกค้า) — เก็บในเครื่องเท่านั้น
 *   conversations-<เวลา>.csv        สำหรับวิเคราะห์: ชื่อลูกค้าแทนด้วยรหัส C001… · เบอร์/อีเมลในข้อความถูกปิด
 *                                   · ชื่อในข้อความระบบ ("X replied to an ad" · "You called X") และชื่อโปรไฟล์ที่โผล่ตรงไหนก็ตามถูกแทนด้วยรหัส
 *
 * กติกา: ไม่พิมพ์ token หรือ URL ที่มี token ลง log เด็ดขาด · อ่านอย่างเดียว ไม่ส่งข้อความหาใคร
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── อ่าน .env.export ─────────────────────────────────────────────────
const envFile = path.join(root, ".env.export");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const argv = process.argv.slice(2);
const fromJsonIdx = argv.indexOf("--from-json");
const fromJson = fromJsonIdx >= 0 ? argv[fromJsonIdx + 1] : null;

const token = process.env.FB_EXPORT_PAGE_TOKEN;
const pageId = process.env.FB_PAGE_ID;
const version = process.env.GRAPH_API_VERSION || "v21.0";
// ใช้ทดสอบกับตัวปลอมในเครื่องเท่านั้น
const base = (process.env.FB_GRAPH_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");

if (!fromJson && (!token || !pageId)) {
  console.error("❌ ต้องมี FB_EXPORT_PAGE_TOKEN และ FB_PAGE_ID ในไฟล์ .env.export ก่อน");
  process.exit(1);
}

const args = argv;
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : null;
if (since && Number.isNaN(since.getTime())) {
  console.error("❌ --since ต้องเป็นวันที่ เช่น 2026-11-08");
  process.exit(1);
}

/** ตัด access_token ออกจาก URL ก่อนเอาไปแสดง/บันทึก */
const redact = (u) => String(u).replace(/access_token=[^&]+/g, "access_token=REDACTED");

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const code = json?.error?.code;
    // 4 / 17 / 32 / 613 = โดนจำกัดความถี่ → รอแล้วลองใหม่
    if ([4, 17, 32, 613].includes(code) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    throw new Error(
      `Graph API ${res.status} code=${code ?? "-"}: ${json?.error?.message ?? "ไม่ทราบสาเหตุ"} (${redact(url).split("?")[0]})`,
    );
  }
}

let conversations = [];
let exportPageId = pageId;
let jsonPath;
const outDir = path.join(root, "exports");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

if (fromJson) {
  jsonPath = path.resolve(root, fromJson);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  conversations = raw.conversations ?? [];
  exportPageId = raw.page_id ?? pageId;
} else {
  const firstUrl =
    `${base}/${version}/${pageId}/conversations?platform=messenger&limit=50` +
    `&fields=${encodeURIComponent("participants,updated_time,messages.limit(100){message,from,created_time}")}` +
    `&access_token=${encodeURIComponent(token)}`;


  let url = firstUrl;
  let pages = 0;
  outer: while (url) {
    const page = await getJson(url);
    pages++;
    for (const c of page.data ?? []) {
      if (since && new Date(c.updated_time) < since) {
        // Graph เรียงห้องจากอัปเดตล่าสุดก่อน — เจอห้องเก่ากว่าแล้วหยุดได้เลย
        break outer;
      }
      // ข้อความในห้องหนึ่งก็แบ่งหน้าเหมือนกัน ต้องตามให้ครบ
      const messages = [...(c.messages?.data ?? [])];
      let next = c.messages?.paging?.next;
      while (next) {
        const more = await getJson(next);
        messages.push(...(more.data ?? []));
        next = more.paging?.next;
      }
      conversations.push({ id: c.id, updated_time: c.updated_time, participants: c.participants?.data ?? [], messages });
    }
    url = page.paging?.next ?? null;
    process.stdout.write(`\rดึงแล้ว ${conversations.length} ห้อง (${pages} หน้า)`);
  }
  process.stdout.write("\n");


  fs.mkdirSync(outDir, { recursive: true });
  jsonPath = path.join(outDir, `conversations-${stamp}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ exported_at: new Date().toISOString(), page_id: pageId, conversations }, null, 2),
  );
}

// ── บันทึก ───────────────────────────────────────────────────────────

// รหัสแทนชื่อลูกค้า: คนเดิมได้รหัสเดิมทั้งไฟล์
const codes = new Map();
const codeOf = (id) => {
  if (!codes.has(id)) codes.set(id, `C${String(codes.size + 1).padStart(3, "0")}`);
  return codes.get(id);
};
// ── ชื่อทุกคนที่ Facebook ให้มา (ผู้ร่วมห้อง + ผู้ส่ง) → รหัสเดียวกับคอลัมน์ customer ──────────
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameToCode = new Map(); // ชื่อเต็ม/ส่วนของชื่อ → รหัส
for (const c of conversations) {
  for (const p of [...(c.participants ?? []), ...(c.messages ?? []).map((m) => m.from).filter(Boolean)]) {
    if (!p?.id || p.id === exportPageId || !p.name) continue;
    const code = codeOf(p.id);
    const full = String(p.name).trim();
    if (full) nameToCode.set(full, code);
    for (const part of full.split(/\s+/)) {
      // ส่วนของชื่อที่สั้นมาก (เช่น 2 ตัวอักษรละติน) จะไปกินคำทั่วไป — ชื่อเต็มยังถูกปิดอยู่ดี
      if (part.length >= 3 && !nameToCode.has(part)) nameToCode.set(part, code);
    }
  }
}
// ยาวก่อน เพื่อให้ชื่อเต็มถูกแทนก่อนส่วนของชื่อ
const nameList = [...nameToCode.keys()].sort((a, b) => b.length - a.length);
const nameRe = nameList.length
  ? new RegExp(nameList.map((n) => (/^[\x00-\x7F]+$/.test(n) ? `\\b${escapeRe(n)}\\b` : escapeRe(n))).join("|"), "gi")
  : null;
const codeByLower = new Map(nameList.map((n) => [n.toLowerCase(), nameToCode.get(n)]));

/** ปิดชื่อในข้อความระบบของ Facebook ก่อน (รูปแบบที่รู้จัก) แล้วปิดชื่อโปรไฟล์ที่เหลือทุกจุด */
const maskNames = (text) => {
  let t = String(text ?? "")
    .replace(/^(.+?) (replied to an ad|replied to a post|replied to your ad|ได้ตอบกลับโพสต์|ได้ตอบกลับโฆษณา)/u, "[ลูกค้า] $2")
    .replace(/\bYou called ([^.\n]+)\./g, "You called [ลูกค้า].")
    .replace(/\bYou can call ([^\n]+?) within/g, "You can call [ลูกค้า] within")
    .replace(/^([^\n]+?) called you\b/g, "[ลูกค้า] called you")
    .replace(/missed (a )?(voice |video )?call from ([^.\n]+)/gi, "missed $1$2call from [ลูกค้า]");
  if (nameRe) t = t.replace(nameRe, (m) => codeByLower.get(m.toLowerCase()) ?? "[ชื่อ]");
  return t;
};

const mask = (s) =>
  maskNames(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[อีเมล]")
    .replace(/(?:\+?66|0)[\d\s-]{8,11}\d/g, "[เบอร์]");
const cell = (v) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // กัน Excel รันสูตร
  return `"${safe.replace(/"/g, '""')}"`;
};

const rows = [["conversation", "customer", "updated_time", "created_time", "from", "message"]];
for (const c of conversations) {
  const customer = (c.participants ?? []).find((p) => p.id !== exportPageId);
  const cust = customer ? codeOf(customer.id) : "C???";
  // เรียงข้อความจากเก่าไปใหม่ ให้อ่านเป็นบทสนทนา
  const msgs = [...(c.messages ?? [])].sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
  for (const m of msgs) {
    rows.push([c.id, cust, c.updated_time, m.created_time, m.from?.id === exportPageId ? "เพจ" : cust, mask(m.message)]);
  }
}
const csvPath = fromJson ? jsonPath.replace(/\.json$/, ".csv") : path.join(outDir, `conversations-${stamp}.csv`);
fs.writeFileSync(csvPath, "﻿" + rows.map((r) => r.map(cell).join(",")).join("\n"));

const msgCount = conversations.reduce((n, c) => n + (c.messages ?? []).length, 0);
console.log(`✅ ${conversations.length} ห้อง · ${msgCount} ข้อความ · ลูกค้า ${codes.size} คน`);
console.log(`   ข้อมูลดิบ (มีชื่อ เก็บในเครื่องเท่านั้น): ${path.relative(root, jsonPath)}`);
console.log(`   สำหรับวิเคราะห์ (รหัสแทนชื่อ):        ${path.relative(root, csvPath)}`);
