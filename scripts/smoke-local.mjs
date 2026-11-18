#!/usr/bin/env node
/**
 * smoke test ทั้งเส้นในเครื่อง โดยไม่แตะ Facebook / Supabase / LINE ของจริงเลย
 *
 * ทำอะไร:
 *   1. เปิด "ตัวปลอม" บนพอร์ต 54390 — แทน Supabase (PostgREST เท่าที่โค้ดใช้), Graph API ของ Facebook และ LINE
 *   2. ยิงข้อความลูกค้าแบบมีลายเซ็นจริงเข้า webhook ของ next dev (http://localhost:3111)
 *   3. รอดูว่าบอตส่งอะไรออกไปหา "Facebook ปลอม" แล้วพิมพ์เป็นบทสนทนา + ตาราง leads + ข้อความ LINE ที่แจ้งต้น
 *
 * วิธีใช้ (2 หน้าต่าง):
 *   หน้าต่าง 1:  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54390 \
 *                FB_GRAPH_BASE_URL=http://127.0.0.1:54390/graph \
 *                LINE_API_BASE_URL=http://127.0.0.1:54390/line \
 *                LINE_CHANNEL_ACCESS_TOKEN=fake LINE_NOTIFY_TO=Ufake \
 *                npm run dev
 *   หน้าต่าง 2:  node scripts/smoke-local.mjs
 *
 *   --keep     ไม่ปิดตัวปลอมหลังจบ (ไว้เปิดหน้าแอดมินดูผลในเบราว์เซอร์)
 *   --export   ทดสอบ scripts/export-conversations.mjs กับ Graph ปลอม (มีหลายหน้า) แทน
 *
 * ต้องมี FB_APP_SECRET, FB_PAGE_ID ใน .env.local (ค่าปลอมได้)
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
const SECRET = process.env.FB_APP_SECRET;
const PAGE = process.env.FB_PAGE_ID;
const BOT = process.env.SMOKE_BOT_URL ?? "http://localhost:3111";
const PORT = 54390;
if (!SECRET || !PAGE) {
  console.error("❌ ต้องมี FB_APP_SECRET และ FB_PAGE_ID ใน .env.local");
  process.exit(1);
}

// ═════════════════════════ ฐานข้อมูลปลอม (in-memory) ═════════════════════════
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const DEFAULTS = {
  contacts: () => ({ first_seen_at: now(), last_seen_at: now() }),
  conversations: () => ({ state: "bot_active", lead_step: null, lead_draft: {}, unread_for_admin: false, created_at: now(), updated_at: now(), followup_sent_at: null, followup_variant: null, followup_draft: null, followup_draft_at: null }),
  messages: () => ({ created_at: now() }),
  webhook_events: () => ({ received_at: now(), status: "processing", error_note: null }),
  leads: () => ({ status: "new", created_at: now(), qualification: {} }),
  usage_log: () => ({ created_at: now() }),
  handoff_events: () => ({ created_at: now() }),
};
const UNIQUE = {
  webhook_events: [["event_key"]],
  messages: [["mid"]],
  contacts: [["page_id", "psid"]],
  conversations: [["contact_id"]],
  settings: [["key"]],
  fb_pages: [["page_id"]],
};
// ตรงกับคอลัมน์จริงของ leads หลังรัน 0003 — คอลัมน์อื่นต้อง error เหมือน PostgREST
const LEADS_COLUMNS = new Set([
  "id", "page_id", "conversation_id", "contact_id", "name", "phone", "email", "interest", "lead_type", "note",
  "status", "consent_at", "created_at", "source", "segment", "line_id", "qualification",
]);
const db = {
  fb_pages: [{ id: uuid(), page_id: PAGE, page_name: "TONPALEARN", is_active: true, bot_enabled: true }],
  settings: [
    // ค่าเดียวกับ supabase/migrations/0002_seed.sql
    { key: "handoff_notice", value: { text: "กำลังเรียกทีมงานมาคุยต่อให้ครับ ระหว่างรอ พิมพ์ทิ้งไว้ได้เลยครับ" } },
    { key: "greeting", value: { text: "สวัสดีครับ ยินดีต้อนรับสู่ TONPALEARN 🙏 อยากให้ช่วยเรื่องไหนดีครับ" } },
    // ช่องเวลาว่างที่ต้นกรอก (ตัวอย่างสมมติ · ชื่อวันตรงกับวันที่จริงของปี 2569) — SMOKE_NO_SLOTS=1 = ไม่กรอก
    { key: "meeting_slots", value: { text: process.env.SMOKE_NO_SLOTS ? "" : "ศุกร์ 20 พ.ย. 14:00\nอังคาร 24 พ.ย. 10:00" } },
  ],
  rules: [
    { id: uuid(), page_id: PAGE, name: "ไม่สนใจ", match_type: "regex", pattern: "(ไม่สนใจ|ไม่เอา|ไม่ต้องการ|ขอบคุณครับ พอแล้ว)", action: "reply", reply_text: "ได้ครับ ขอบคุณที่แวะเข้ามานะครับ ถ้าสนใจเมื่อไรทักมาได้เลยครับ 🙏", quick_replies: null, priority: 5, is_active: true },
    { id: uuid(), page_id: PAGE, name: "ขอคุยกับคน", match_type: "regex", pattern: "(คุยกับคน|คุยกับแอดมิน|ขอแอดมิน|เรียกแอดมิน|ต่อแอดมิน)", action: "handoff", reply_text: null, quick_replies: null, priority: 10, is_active: true },
    { id: uuid(), page_id: PAGE, name: "สนใจสมัคร", match_type: "contains", pattern: "สนใจ", action: "collect_lead", reply_text: null, quick_replies: null, priority: 20, is_active: true },
    { id: uuid(), page_id: PAGE, name: "ขอใบเสนอราคา", match_type: "contains", pattern: "ใบเสนอราคา", action: "collect_lead", reply_text: null, quick_replies: null, priority: 21, is_active: true },
    { id: uuid(), page_id: PAGE, name: "ขอเมนู", match_type: "exact", pattern: "เมนู", action: "menu", reply_text: null, quick_replies: null, priority: 30, is_active: true },
  ],
  contacts: [], conversations: [], messages: [], webhook_events: [], leads: [], usage_log: [], handoff_events: [],
  faq_entries: [], kb_documents: [], kb_chunks: [],
};

function parseFilters(params) {
  const filters = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "offset"].includes(k)) continue;
    const m = v.match(/^(not\.)?(eq|neq|gte|lte|gt|lt|is)\.(.*)$/);
    if (m) filters.push({ col: k, not: Boolean(m[1]), op: m[2], val: m[3] });
  }
  return filters;
}
function matches(row, f) {
  const v = row[f.col];
  let ok;
  if (f.op === "is") ok = f.val === "null" ? v === null || v === undefined : String(v) === f.val;
  else if (f.op === "eq") ok = String(v) === f.val;
  else if (f.op === "neq") ok = String(v) !== f.val;
  else if (f.op === "gte") ok = String(v) >= f.val;
  else if (f.op === "lte") ok = String(v) <= f.val;
  else if (f.op === "gt") ok = String(v) > f.val;
  else if (f.op === "lt") ok = String(v) < f.val;
  return f.not ? !ok : ok;
}
function project(row, select) {
  if (!select || select === "*") return { ...row };
  const out = {};
  for (const c of select.split(",")) out[c.trim()] = row[c.trim()] ?? null;
  return out;
}
function conflict(table, row, ignore) {
  for (const cols of UNIQUE[table] ?? []) {
    if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
    const hit = db[table].find((r) => r !== ignore && cols.every((c) => r[c] === row[c]));
    if (hit) return hit;
  }
  return null;
}

function rest(req, res, url, body) {
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  const [, , , table, fn] = url.pathname.split("/"); // /rest/v1/<table> | /rest/v1/rpc/<fn>
  if (table === "rpc") {
    if (fn === "search_faq" || fn === "search_kb") return send(200, []);
    return send(200, null);
  }
  if (!db[table]) return send(404, { code: "42P01", message: `relation ${table} does not exist` });

  const params = url.searchParams;
  const filters = parseFilters(params);
  const prefer = req.headers["prefer"] ?? "";
  const wantObject = (req.headers["accept"] ?? "").includes("vnd.pgrst.object");
  const returnRep = prefer.includes("return=representation");
  const select = params.get("select");

  const finish = (rows, status = 200) => {
    const data = rows.map((r) => project(r, select));
    if (wantObject) {
      if (data.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(status, data[0]);
    }
    return send(status, data);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = db[table].filter((r) => filters.every((f) => matches(r, f)));
    const order = params.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
    }
    const limit = Number(params.get("limit") ?? 0);
    if (limit) rows = rows.slice(0, limit);
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Range": `*/${rows.length}` });
      return res.end();
    }
    return finish(rows);
  }

  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of items) {
      if (table === "leads") {
        const bad = Object.keys(item).filter((k) => !LEADS_COLUMNS.has(k));
        if (bad.length) return send(400, { code: "PGRST204", message: `column ${bad[0]} not found` });
      }
      const row = { id: uuid(), ...(DEFAULTS[table]?.() ?? {}), ...item };
      const dup = conflict(table, row);
      if (dup) {
        if (prefer.includes("resolution=merge-duplicates")) {
          Object.assign(dup, item);
          out.push(dup);
          continue;
        }
        return send(409, { code: "23505", message: `duplicate key value violates unique constraint (${table})` });
      }
      db[table].push(row);
      out.push(row);
    }
    return returnRep ? finish(out, 201) : send(201);
  }

  if (req.method === "PATCH") {
    const rows = db[table].filter((r) => filters.every((f) => matches(r, f)));
    for (const r of rows) Object.assign(r, body);
    return returnRep ? finish(rows) : send(204);
  }
  return send(405, { message: "method not supported by fake" });
}

// ═════════════════════════ Facebook / LINE ปลอม ═════════════════════════
const outbox = []; // { psid, text?, quickReplies?, pass? , at }
const linePushes = [];

function graph(req, res, url, body) {
  const json = (d) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(d));
  };
  if (!url.searchParams.get("access_token")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "no token", code: 190 } }));
  }
  const parts = url.pathname.split("/"); // /graph/<ver>/<page>/<edge>
  const edge = parts[4];
  if (req.method === "POST" && edge === "messages") {
    if (body.message) {
      outbox.push({ psid: body.recipient.id, text: body.message.text, quickReplies: body.message.quick_replies?.map((q) => q.title), at: Date.now() });
    }
    return json({ recipient_id: body.recipient?.id, message_id: `m_${uuid()}` });
  }
  if (req.method === "POST" && edge === "pass_thread_control") {
    outbox.push({ psid: body.recipient.id, pass: body.target_app_id, at: Date.now() });
    return json({ success: true });
  }
  if (req.method === "GET" && edge === "conversations") return json(fakeConversations(url));
  if (req.method === "GET" && parts[3]?.startsWith("t_")) return json(fakeMessagesPage(url, parts[3]));
  // โปรไฟล์ Messenger (ชื่อสมมติ ไม่ใช่คนจริง)
  if (req.method === "GET" && url.searchParams.get("fields")?.includes("first_name")) {
    return json({ first_name: "ลูกค้า", last_name: `สมมติ${parts[3]?.slice(-1) ?? ""}` });
  }
  return json({ success: true });
}

// ข้อมูลปลอมสำหรับทดสอบสคริปต์ export: 3 ห้อง แบ่ง 2 หน้า · ห้องแรกมีข้อความ 2 หน้า
function fakeConversations(url) {
  const after = url.searchParams.get("after");
  const tok = url.searchParams.get("access_token");
  const mk = (id, name, t, msgs, more) => ({
    id,
    updated_time: t,
    participants: { data: [{ id: `psid_${id}`, name }, { id: PAGE, name: "TONPALEARN" }] },
    messages: {
      data: msgs,
      paging: more ? { next: `http://127.0.0.1:${PORT}/graph/v21.0/${id}/messages?after=p2&access_token=${tok}` } : {},
    },
  });
  const m = (text, from, t) => ({ id: uuid(), message: text, from: { id: from, name: from === PAGE ? "TONPALEARN" : "ลูกค้า" }, created_time: t });
  if (!after) {
    return {
      data: [
        mk("t_1", "สมชาย ใจดี", "2026-11-17T10:00:00+0000", [m("ขอบคุณครับ เดี๋ยวโทรหาที่ 081-234-5678", PAGE, "2026-11-17T10:00:00+0000")], true),
        mk("t_2", "มาลี", "2026-11-16T09:00:00+0000", [m("ต่ำกว่า 10 ล้าน", "psid_t_2", "2026-11-16T09:00:00+0000")], false),
      ],
      paging: { next: `http://127.0.0.1:${PORT}/graph/v21.0/${PAGE}/conversations?after=c2&access_token=${tok}` },
    };
  }
  return { data: [mk("t_3", "=HYPERLINK(\"x\")", "2026-11-09T09:00:00+0000", [m("100 ล้านขึ้นไป", "psid_t_3", "2026-11-09T09:00:00+0000")], false)], paging: {} };
}
function fakeMessagesPage() {
  return {
    data: [{ id: uuid(), message: "100 ล้านขึ้นไป อีเมล a@b.co", from: { id: "psid_t_1", name: "สมชาย ใจดี" }, created_time: "2026-11-17T09:59:00+0000" }],
    paging: {},
  };
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
    if (url.pathname.startsWith("/line/")) {
      linePushes.push({ to: body.to, text: body.messages?.[0]?.text, auth: Boolean(req.headers.authorization) });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ═════════════════════════ โหมดทดสอบสคริปต์ export ═════════════════════════
if (process.argv.includes("--export")) {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "export-smoke-"));
  fs.writeFileSync(path.join(tmp, ".env.export"), `FB_EXPORT_PAGE_TOKEN=SECRET_TOKEN_SHOULD_NOT_PRINT\nFB_PAGE_ID=${PAGE}\nGRAPH_API_VERSION=v21.0\n`);
  const script = path.resolve("scripts/export-conversations.mjs");
  const r = await new Promise((resolve) => {
    import("node:child_process").then(({ spawn }) => {
      const p = spawn(process.execPath, [script], { cwd: tmp, env: { ...process.env, FB_EXPORT_PAGE_TOKEN: "", FB_GRAPH_BASE_URL: `http://127.0.0.1:${PORT}/graph` } });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
    });
  });
  console.log(r.out);
  const files = fs.readdirSync(path.join(tmp, "exports"));
  const csv = fs.readFileSync(path.join(tmp, "exports", files.find((f) => f.endsWith(".csv"))), "utf8");
  const json = fs.readFileSync(path.join(tmp, "exports", files.find((f) => f.endsWith(".json"))), "utf8");
  console.log("── CSV ──\n" + csv);
  const leaks = [r.out, csv, json].some((s) => s.includes("SECRET_TOKEN_SHOULD_NOT_PRINT"));
  console.log(`token หลุดใน log/ไฟล์: ${leaks ? "❌ หลุด" : "✅ ไม่หลุด"}`);
  console.log(`ชื่อลูกค้าใน CSV: ${/สมชาย|มาลี/.test(csv) ? "❌ ยังมีชื่อ" : "✅ แทนด้วยรหัสแล้ว"}`);
  console.log(`เบอร์/อีเมลใน CSV: ${/0812345678|081-234-5678|a@b\.co/.test(csv) ? "❌ ยังเห็น" : "✅ ปิดแล้ว"}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
  process.exit(r.code ?? 0);
}

// ═════════════════════════ ยิงบทสนทนาเข้า webhook ═════════════════════════
async function sendToBot(psid, text) {
  const payload = {
    object: "page",
    entry: [{ id: PAGE, time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: PAGE }, timestamp: Date.now(), message: { mid: `smoke_${uuid()}`, text } }] }],
  };
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
  const res = await fetch(`${BOT}/api/webhook/facebook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  if (res.status !== 200) throw new Error(`webhook ตอบ ${res.status}`);
}

async function waitReply(psid, since, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const got = outbox.filter((o) => o.psid === psid && o.at >= since && o.text);
    if (got.length) {
      await new Promise((r) => setTimeout(r, 400)); // เผื่อ pass_thread_control ตามมา
      return outbox.filter((o) => o.psid === psid && o.at >= since);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

const scenarios = [
  { key: "a", name: "(a) ปุ่ม 100 ล้านขึ้นไป · จนส่งต่อต้น", lines: ["100 ล้านขึ้นไป", "สรุปตัวเลขผู้บริหาร", "ต้องรวมยอดขายจากหลายสาขาทุกเช้า", "กลุ่มบริษัทค้าปลีก 4 บริษัท", "อังคาร 24 พ.ย. 10:00", "081-234-5678", "ยังอยู่ไหมครับ"] },
  { key: "b", name: "(b) เจ้าของโรงงาน ถาม 'มีตัวอย่างไหม' แล้วถาม 'SI?'", lines: ["10–100 ล้าน", "งานในโรงงาน", "มีตัวอย่างไหมครับ", "โรงงานฉีดพลาสติก", "SI?", "ไม่มี"] },
  { key: "c", name: "(c) ถามว่า 'นี่บอทตอบเหรอ'", lines: ["100 ล้านขึ้นไป", "นี่บอทตอบเหรอครับ", "ยังอยู่ไหมครับ"] },
  { key: "d", name: "(d) ลูกค้าเงียบหลังคำถามแรก (ใช้ต่อในช่วงตามอัตโนมัติ)", lines: ["ต่ำกว่า 10 ล้าน"] },
];

const psidOf = {};
let i = 0;
for (const sc of scenarios) {
  const psid = `smoke_psid_${++i}`;
  psidOf[sc.key] = psid;
  console.log(`\n━━━━━━━━ ${sc.name} ━━━━━━━━`);
  for (const line of sc.lines) {
    const t0 = Date.now();
    console.log(`👤 ลูกค้า: ${line}`);
    await sendToBot(psid, line);
    const got = await waitReply(psid, t0, line === "ยังอยู่ไหมครับ" ? 3000 : 20000);
    if (got.length === 0) console.log("🤖 บอต: (เงียบ)");
    printOut(got);
  }
}

function printOut(got) {
  for (const o of got) {
    if (o.text) console.log(`🤖 บอต: ${o.text.replace(/\n/g, "\n         ")}${o.quickReplies ? `\n         [ปุ่ม: ${o.quickReplies.join(" | ")}]` : ""}`);
    if (o.pass) console.log(`   ↪ โอนสายให้ Page Inbox (app ${o.pass})`);
  }
}

// ═════════════════════ (d) ตามต่ออัตโนมัติผ่าน /api/cron/followup ═════════════════════
async function cron(secret = process.env.CRON_SECRET) {
  const res = await fetch(`${BOT}/api/cron/followup`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
  const body = await res.text();
  return { status: res.status, body: body.startsWith("{") ? JSON.parse(body) : body };
}
const convoOf = (psid) => {
  const c = db.contacts.find((x) => x.psid === psid);
  return db.conversations.find((x) => x.contact_id === c?.id);
};
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();

console.log("\n━━━━━━━━ (d) ตามต่ออัตโนมัติ ━━━━━━━━");
const dConvo = convoOf(psidOf.d);
console.log(`เรียก cron ไม่มีรหัสลับ → ${(await cron("")).status}`);
console.log(`เรียก cron รหัสผิด → ${(await cron("wrong-secret-wrong-secret")).status}`);

// d1: ในกรอบ — ลูกค้าเงียบมา 5 ชม.
dConvo.last_user_message_at = ago(5);
dConvo.last_bot_message_at = ago(4.99);
let t0 = Date.now();
let r = await cron();
console.log(`d1 ลูกค้าเงียบ 5 ชม. (ในกรอบ 24 ชม.) → cron ${r.status} ส่ง ${r.body.sent?.length ?? 0} ห้อง`);
printOut(outbox.filter((o) => o.psid === psidOf.d && o.at >= t0));
t0 = Date.now();
r = await cron();
console.log(`d1 เรียก cron ซ้ำทันที → ส่ง ${r.body.sent?.length ?? 0} ห้อง · ข้อความใหม่ถึงลูกค้า ${outbox.filter((o) => o.psid === psidOf.d && o.at >= t0).length} ชิ้น (ต้องเป็น 0 — ส่งครั้งเดียว)`);

// d2: ลูกค้าคนเดิม เลยกรอบ — ล้างธงว่าเคยส่ง แล้วถอยเวลาไป 25 ชม.
dConvo.followup_sent_at = null;
dConvo.last_user_message_at = ago(25);
dConvo.last_bot_message_at = ago(24.99);
t0 = Date.now();
r = await cron();
const skippedWhy = r.body.skipped?.find((x) => x.conversationId === dConvo.id)?.why ?? "(ไม่อยู่ในรายการที่ cron ดึงมาเลย เพราะเกิน 24 ชม.)";
console.log(`d2 ลูกค้าคนเดิมเงียบ 25 ชม. (เลยกรอบ) → ส่ง ${r.body.sent?.length ?? 0} ห้อง · ข้อความถึงลูกค้า ${outbox.filter((o) => o.psid === psidOf.d && o.at >= t0).length} ชิ้น · เหตุผล: ${skippedWhy}`);

// d3: คนรับสายแล้ว (ห้อง c ถูกส่งต่อไปแล้ว) แม้อยู่ในกรอบ → ไม่ส่ง
const cConvo = convoOf(psidOf.c);
cConvo.last_user_message_at = ago(5);
cConvo.last_bot_message_at = ago(4.99);
t0 = Date.now();
r = await cron();
console.log(`d3 ห้องที่ส่งต่อคนแล้ว (สถานะ ${cConvo.state}) เงียบ 5 ชม. → ข้อความถึงลูกค้า ${outbox.filter((o) => o.psid === psidOf.c && o.at >= t0).length} ชิ้น`);

console.log("\n━━━━━━━━ ร่างตามรอบ 2 ที่บันทึกในห้อง (บอตไม่ส่ง) ━━━━━━━━");
for (const k of ["a", "b", "c", "d"]) {
  const cv = convoOf(psidOf[k]);
  console.log(`${k}: ${cv?.followup_draft ?? "(ยังไม่มี)"} · ห้อง ${cv?.id}`);
}
const draftSent = outbox.some((o) => o.text && /ผมจะไม่ทักซ้ำ/.test(o.text));
console.log(`ร่างรอบ 2 ถูกส่งหาลูกค้า: ${draftSent ? "❌ ส่งแล้ว" : "✅ ไม่เคยส่ง"}`);

const sources = db.messages.filter((m) => m.direction === "out").reduce((acc, m) => ((acc[m.answer_source] = (acc[m.answer_source] ?? 0) + 1), acc), {});
console.log("\n━━━━━━━━ ที่มาของข้อความขาออก ━━━━━━━━");
console.log(sources);
console.log("\n━━━━━━━━ ตาราง leads (ฐานปลอม) ━━━━━━━━");
for (const l of db.leads) {
  console.log({ segment: l.segment, name: l.name, phone: l.phone, line_id: l.line_id, consent_at: Boolean(l.consent_at), reason: l.qualification?.reason, fields: l.qualification?.fields });
}
console.log(`\n━━━━━━━━ LINE ที่แจ้งต้น (${linePushes.length} ข้อความ) ━━━━━━━━`);
for (const p of linePushes) console.log(`→ ${p.to}\n${p.text}\n`);
console.log(`เรียกโมเดลสกัดค่า: ${db.usage_log.length} ครั้ง`);
if (process.argv.includes("--keep")) {
  console.log("\n(--keep) ตัวปลอมยังเปิดอยู่ เปิด http://localhost:3111/admin/leads ดูได้ · Ctrl+C เพื่อปิด");
} else {
  server.close();
}
