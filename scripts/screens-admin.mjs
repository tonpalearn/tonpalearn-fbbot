#!/usr/bin/env node
/**
 * ถ่ายภาพหน้าจอแอดมินทุกหน้า × 2 ขนาด (1280 · 390) × 2 โหมด (สว่าง · มืด) ด้วย Chrome ในเครื่อง
 * ไม่ต้องลง Playwright — คุย Chrome ผ่าน DevTools Protocol ตรง ๆ (Node 22 มี WebSocket ในตัว)
 *
 * ต้องเปิดไว้ก่อน: node scripts/mock-admin.mjs  +  next dev ที่ชี้ไปฐานปลอม (ดูหัวไฟล์ mock-admin.mjs)
 * ใช้:  node scripts/screens-admin.mjs [โฟลเดอร์ปลายทาง]   (ค่าเริ่มต้น docs/screens/admin-redesign)
 *       SCREENS_ONLY=today,inbox  ถ่ายเฉพาะบางหน้า · SCREENS_PREFIX=empty-  ใส่คำนำหน้าชื่อไฟล์
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.SCREENS_BASE ?? "http://localhost:3111";
const OUT = path.resolve(process.argv[2] ?? "docs/screens/admin-redesign");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const PREFIX = process.env.SCREENS_PREFIX ?? "";
fs.mkdirSync(OUT, { recursive: true });

// รหัสผ่านปลอมจาก .env.local (ค่าทดสอบในเครื่องเท่านั้น)
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
const PASS = envText.match(/^ADMIN_PASSCODE=(.*)$/m)?.[1]?.replace(/^["']|["']$/g, "").trim();
if (!PASS) throw new Error("ไม่พบ ADMIN_PASSCODE ใน .env.local");

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passcode: PASS }),
});
const setCookie = login.headers.get("set-cookie") ?? "";
const [cookieName, cookieValue] = setCookie.split(";")[0].split("=");
if (!cookieValue) throw new Error(`ล็อกอินไม่ผ่าน (${login.status})`);
const cookieHeader = `${cookieName}=${cookieValue}`;

// ห้องตัวอย่างที่มีการ์ดผู้สนใจ + ร่างรอบ 2
const convos = await (await fetch(`${BASE}/api/admin/conversations?limit=200`, { headers: { cookie: cookieHeader } })).json();
const sample = convos.items?.find((c) => c.state === "awaiting_human" && c.hasDraft && c.unread) ?? convos.items?.[0];

const PAGES = [
  ["today", "/admin"],
  ["inbox", "/admin/inbox"],
  ["conversation", sample ? `/admin/inbox/${sample.id}` : "/admin/inbox"],
  ["leads", "/admin/leads"],
  ["faq", "/admin/faq"],
  ["rules", "/admin/rules"],
  ["kb", "/admin/kb"],
  ["settings", "/admin/settings"],
  ["login", "/admin/login"],
].filter(([k]) => !process.env.SCREENS_ONLY || process.env.SCREENS_ONLY.split(",").includes(k));

const SIZES = [
  ["desktop", 1280, 860, false],
  ["mobile", 390, 844, true],
];
const THEMES = ["light", "dark"];

// ── Chrome ──────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "admin-screens-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--remote-allow-origins=*",
  "--force-device-scale-factor=1",
  "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch {}
  if (!target) await sleep(200);
}
if (!target) throw new Error("เปิด Chrome ไม่ได้");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", () => j(new Error("ต่อ DevTools ไม่ได้")), { once: true });
});
console.log("ต่อ Chrome แล้ว");
let seq = 0;
const waiting = new Map();
const listeners = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) listeners.forEach((l) => l(msg));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send("Page.enable");
if (process.env.DEBUG) {
  await send("Runtime.enable");
  listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown") console.log("EXC", JSON.stringify(m.params.exceptionDetails).slice(0, 600));
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
      console.log("CONSOLE", m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400));
  });
}
await send("Network.enable");
await send("Network.setCookie", { name: cookieName, value: cookieValue, url: BASE, path: "/" });

async function waitReady() {
  for (let i = 0; i < 80; i += 1) {
    const ready = await evaluate(
      `document.readyState === "complete" && !document.querySelector(".skeleton") && document.fonts.status === "loaded"`,
    ).catch(() => false);
    if (ready) return;
    await sleep(150);
  }
}

const files = [];
for (const [size, w, h, mobile] of SIZES) {
  for (const theme of THEMES) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [name, url] of PAGES) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await send("Page.navigate", { url: `${BASE}${url}` });
      await sleep(400);
      await waitReady();
      await sleep(350);
      // ขยายความสูงจอให้เท่าเนื้อหาจริง แล้วถ่ายทั้งหน้า (แถบล่าง/ปุ่มติดล่างไปอยู่ท้ายภาพ)
      let height = h;
      for (let i = 0; i < 4; i += 1) {
        const full = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
        if (full <= height) break;
        height = Math.min(full, 9000);
        await send("Emulation.setDeviceMetricsOverride", { width: w, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
        await sleep(250);
      }
      // ซ่อนปุ่มของ next dev (ถ้าถ่ายจาก dev server)
      await evaluate(`document.querySelectorAll("nextjs-portal").forEach((e) => e.remove())`);
      const overflowX = await evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, `${PREFIX}${name}-${size}-${theme}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      files.push(file);
      console.log(`${path.basename(file)}  ${w}×${height}${overflowX > 0 ? `  ⚠ ล้นแนวนอน ${overflowX}px` : ""}`);
    }
  }
}

// ภาพเสริม: แผงการแสดงผล + เมนูเพิ่มเติม (มือถือ)
if (!process.env.SCREENS_ONLY) {
  for (const theme of THEMES) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [name, selector] of [
      ["display-panel", 'button[aria-label="การแสดงผล"]'],
      ["more-menu", 'button[aria-haspopup="dialog"]'],
    ]) {
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send("Page.navigate", { url: `${BASE}/admin/inbox` });
      await sleep(400);
      await waitReady();
      await evaluate(`document.querySelector('${selector}').click()`);
      await sleep(400);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, `${PREFIX}${name}-mobile-${theme}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      files.push(file);
      console.log(path.basename(file));
    }
  }
}

ws.close();
chrome.kill();
await sleep(500);
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}
console.log(`\nบันทึก ${files.length} ภาพที่ ${OUT}`);
