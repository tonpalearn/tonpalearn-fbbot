/**
  * ยามหน้าประตูของหน้า /admin/* (Next 16 เรียกไฟล์นี้ว่า proxy แทน middleware)
 *
 * ทำไมไม่ import lib/auth.ts ตรง ๆ: ไฟล์นั้นดึง `next/headers` เข้ามาด้วย
 * ซึ่งใช้ใน middleware ไม่ได้ — ที่นี่จึงตรวจลายเซ็นคุกกี้ซ้ำเอง
 * โดยใช้ Web Crypto (crypto.subtle) ที่ทำงานได้ทั้ง Node และ Edge
 * สูตรการเซ็นต้องตรงกับ lib/auth.ts เป๊ะ: `<เวลาหมดอายุ>.<HMAC-SHA256 เป็น hex>`
 */
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "fbchat_admin";
const LOGIN_PATH = "/admin/login";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** เทียบสตริงแบบเวลาคงที่ กันการเดาลายเซ็นทีละตัวอักษร */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hasValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;

  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.trim() === "") return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  if (!safeEqual(expected, mac)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // หน้าล็อกอินต้องเข้าได้เสมอ ไม่งั้นจะวนไม่รู้จบ
  if (pathname === LOGIN_PATH) return NextResponse.next();

  if (await hasValidSession(req.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // ไฟล์ proxy ของ Next 16 รันบน Node.js เสมอ จึงไม่ต้องระบุ runtime เอง
  // คุมเฉพาะหน้าเว็บของแอดมิน — ส่วน /api/admin/* มี requireAdmin() ป้องกันอยู่แล้ว
  // และไม่ควรถูก redirect ไปหน้า HTML เวลาเรียกด้วย fetch
  matcher: ["/admin", "/admin/:path*"],
};
