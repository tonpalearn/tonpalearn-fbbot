#!/usr/bin/env node
/**
 * ยิงข้อความปลอมเข้า webhook ของเราเอง เพื่อตรวจว่าเส้นทางทั้งเส้นทำงานจริง
 * ใช้ตอนพัฒนา ไม่ต้องรอ Facebook
 *
 *   node scripts/smoke-webhook.mjs "ราคาเท่าไรครับ"
 *   node scripts/smoke-webhook.mjs "ขอคุยกับคน" --url https://your-app.vercel.app
 *
 * ต้องมี FB_APP_SECRET กับ FB_PAGE_ID ใน .env.local
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// อ่าน .env.local แบบง่าย ๆ
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith("--")) ?? "สวัสดีครับ";
const urlIdx = args.indexOf("--url");
const base = urlIdx >= 0 ? args[urlIdx + 1] : "http://localhost:3111";
const psid = process.env.SMOKE_PSID ?? "9999999999";

const secret = process.env.FB_APP_SECRET;
const pageId = process.env.FB_PAGE_ID;
if (!secret || !pageId) {
  console.error("❌ ต้องตั้ง FB_APP_SECRET และ FB_PAGE_ID ใน .env.local ก่อน");
  process.exit(1);
}

const payload = {
  object: "page",
  entry: [
    {
      id: pageId,
      time: Date.now(),
      messaging: [
        {
          sender: { id: psid },
          recipient: { id: pageId },
          timestamp: Date.now(),
          message: { mid: `smoke_${Date.now()}`, text },
        },
      ],
    },
  ],
};

const raw = JSON.stringify(payload);
const signature =
  "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");

const res = await fetch(`${base}/api/webhook/facebook`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
  body: raw,
});

console.log(`สถานะ: ${res.status} ${res.statusText}`);
console.log(`เนื้อหา: ${await res.text()}`);
console.log(
  res.status === 200
    ? "✅ webhook รับข้อความแล้ว — ดูผลการตอบใน log ของเซิร์ฟเวอร์ หรือในหน้า /admin/inbox"
    : "❌ ไม่ผ่าน — เช็ก FB_APP_SECRET ว่าตรงกับที่เซิร์ฟเวอร์ใช้ไหม",
);

// ทดสอบการยืนยัน webhook ด้วย
if (process.env.FB_VERIFY_TOKEN) {
  const verifyUrl = `${base}/api/webhook/facebook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
    process.env.FB_VERIFY_TOKEN,
  )}&hub.challenge=ping123`;
  const vres = await fetch(verifyUrl);
  const vtext = await vres.text();
  console.log(
    vtext === "ping123"
      ? "✅ การยืนยัน webhook (GET) ผ่าน"
      : `❌ การยืนยัน webhook ไม่ผ่าน: ${vres.status} ${vtext}`,
  );
}
