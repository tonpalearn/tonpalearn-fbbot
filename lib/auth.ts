/**
 * ล็อกอินหน้าแอดมินแบบรหัสผ่านเดียว (passcode) — พอสำหรับทีมเล็กที่ใช้กันไม่กี่คน
 * คุกกี้ถูกเซ็นด้วย HMAC จึงปลอมไม่ได้ถ้าไม่รู้ ADMIN_SESSION_SECRET
 */
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE_NAME = "fbchat_admin";
const MAX_AGE_SEC = 60 * 60 * 12; // 12 ชั่วโมง

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.admin.sessionSecret()).update(payload).digest("hex");
}

export function createSessionValue(): string {
  const expiresAt = Date.now() + MAX_AGE_SEC * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function isValidSessionValue(value: string | undefined): boolean {
  if (!value) return false;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;

  const expected = sign(payload);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/** เทียบรหัสผ่านแบบเวลาคงที่ กันการเดาทีละตัวอักษร */
export function passcodeMatches(input: string): boolean {
  const expected = env.admin.passcode();
  const a = Buffer.from(input ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SEC,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  },
};

/** ใช้ใน Server Component / Route Handler เพื่อเช็กว่าล็อกอินอยู่ไหม */
export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionValue(store.get(COOKIE_NAME)?.value);
}

/** ใช้ต้นทางของทุก API แอดมิน — คืน Response 401 ถ้ายังไม่ล็อกอิน */
export async function requireAdmin(): Promise<Response | null> {
  if (await isLoggedIn()) return null;
  return Response.json({ error: "ยังไม่ได้เข้าสู่ระบบ" }, { status: 401 });
}
