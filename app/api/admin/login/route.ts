/**
 * เข้าสู่ระบบด้วยรหัสผ่านเดียว
 * ตั้งคุกกี้ที่เซ็นด้วย HMAC แล้วให้หน้าเว็บพาไปต่อเอง
 */
import { NextResponse } from "next/server";
import { createSessionValue, passcodeMatches, sessionCookie } from "@/lib/auth";
import { asString, bad, fail, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * กันเดารหัสแบบหยาบ ๆ: นับความพยายามที่ล้มเหลวต่อไอพีในหน่วยความจำ
 * (บนเซิร์ฟเวอร์ไร้สถานะ ตัวนับจะรีเซ็ตเมื่อเครื่องใหม่ขึ้นมา — ถือเป็นด่านเสริม
 *  ด่านจริงคือ ADMIN_PASSCODE ที่ต้องตั้งให้ยาว)
 */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; firstAt: number }>();

function tooManyAttempts(ip: string): boolean {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > WINDOW_MS) {
    fails.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function noteFail(ip: string): void {
  const rec = fails.get(ip);
  if (!rec || Date.now() - rec.firstAt > WINDOW_MS) {
    fails.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  rec.count += 1;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (tooManyAttempts(ip)) {
      return bad("ใส่รหัสผิดหลายครั้งเกินไป กรุณารอสัก 5 นาทีแล้วลองใหม่ครับ", 429);
    }

    const body = await readJson(req);
    const passcode = asString(body.passcode) ?? "";

    if (passcode === "") return bad("กรุณากรอกรหัสผ่าน");
    if (!passcodeMatches(passcode)) {
      noteFail(ip);
      return bad("รหัสผ่านไม่ถูกต้อง", 401);
    }

    fails.delete(ip);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie.name, createSessionValue(), sessionCookie.options);
    return res;
  } catch (err) {
    return fail("login", err, "เข้าสู่ระบบไม่สำเร็จ ระบบอาจยังตั้งค่าไม่ครบ");
  }
}
