#!/usr/bin/env node
/**
 * ทดสอบว่าคีย์ Gemini ใช้ได้จริง และ "กติกาห้ามแต่งข้อมูล" ทำงานจริง
 *
 *   node scripts/smoke-gemini.mjs
 *
 * ต้องมี GEMINI_API_KEY ใน .env.local ก่อน (เอาจาก aistudio.google.com/apikey)
 * ยิงจริง 2 ครั้ง ค่าใช้จ่ายหลักสตางค์
 */
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!apiKey || apiKey.startsWith("local_")) {
  console.error("❌ ยังไม่ได้ใส่ GEMINI_API_KEY จริงใน .env.local");
  console.error("   เอาคีย์จาก https://aistudio.google.com/apikey");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const SYSTEM = [
  "คุณคือผู้ช่วยตอบแชทของเพจ TONPALEARN พูดสุภาพ กระชับ ลงท้ายว่า ครับ",
  "",
  "กติกาที่ห้ามฝ่าฝืน:",
  '1. ตอบได้เฉพาะจากข้อมูลใน <เนื้อหาอ้างอิง> เท่านั้น ถ้าข้อมูลไม่พอให้ตอบว่า "ตอบไม่ได้" คำเดียว',
  "2. ห้ามแต่งราคา วันเวลา จำนวน หรือเงื่อนไขขึ้นเอง เด็ดขาด",
].join("\n");

const REFERENCE =
  "[1] คอร์ส OPB Builder\nคอร์สสอนสร้างผู้ช่วย AI ให้ธุรกิจ เรียนแบบมาที่ห้องเรียน 2 วัน รับจำกัด 20 ที่นั่ง";

async function ask(question) {
  const started = Date.now();
  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `<เนื้อหาอ้างอิง>\n${REFERENCE}\n</เนื้อหาอ้างอิง>\n\nคำถามของลูกค้า: ${question}`,
          },
        ],
      },
    ],
    config: { systemInstruction: SYSTEM, maxOutputTokens: 700, temperature: 0.2 },
  });
  return {
    text: (res.text ?? "").trim(),
    inTok: res.usageMetadata?.promptTokenCount ?? 0,
    outTok: res.usageMetadata?.candidatesTokenCount ?? 0,
    ms: Date.now() - started,
  };
}

console.log(`โมเดล: ${model}\n`);

// เคส 1 — ข้อมูลมีอยู่จริง ควรตอบได้
const a = await ask("คอร์สนี้เรียนกี่วันครับ");
console.log("── เคส 1: ถามสิ่งที่มีในเนื้อหา ──");
console.log(`ถาม: คอร์สนี้เรียนกี่วันครับ`);
console.log(`ตอบ: ${a.text}`);
console.log(`โทเคน: เข้า ${a.inTok} / ออก ${a.outTok} · ${a.ms} ms`);
console.log(a.text && a.text !== "ตอบไม่ได้" ? "✅ ตอบได้ตามที่ควร\n" : "⚠️ ควรตอบได้แต่กลับตอบไม่ได้\n");

// เคส 2 — ถามราคาซึ่งไม่มีในเนื้อหา ต้องไม่แต่งตัวเลข
const b = await ask("ราคาเท่าไรครับ");
console.log("── เคส 2: ถามสิ่งที่ไม่มีในเนื้อหา (ห้ามแต่ง) ──");
console.log(`ถาม: ราคาเท่าไรครับ`);
console.log(`ตอบ: ${b.text}`);
const madeUpNumber = /\d[\d,]*\s*(บาท|฿)/.test(b.text);
console.log(
  b.text.startsWith("ตอบไม่ได้")
    ? "✅ ปฏิเสธถูกต้อง ไม่แต่งราคา"
    : madeUpNumber
      ? "❌ อันตราย: โมเดลแต่งราคาขึ้นเอง — ต้องปรับ prompt (แต่ตาข่ายใน lib/guard.ts จะกันไว้อีกชั้น)"
      : "🟡 ไม่ได้ตอบว่า 'ตอบไม่ได้' ตรง ๆ แต่ก็ไม่ได้แต่งตัวเลข — อ่านคำตอบข้างบนแล้วตัดสินเอง",
);
