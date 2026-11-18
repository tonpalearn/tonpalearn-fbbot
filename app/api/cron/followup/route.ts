/**
 * Vercel Cron → ตามต่ออัตโนมัติ 1 ข้อความ (lib/followup.ts)
 * Vercel ส่ง header `Authorization: Bearer ${CRON_SECRET}` มาเอง เมื่อตั้ง env CRON_SECRET ในโปรเจกต์
 * ไม่ตั้ง CRON_SECRET = ปิดเส้นนี้ (503) — ห้ามเปิดให้ใครเรียกส่งข้อความหาลูกค้าได้
 */
import crypto from "node:crypto";
import { runFollowups } from "@/lib/followup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return new Response("ยังไม่ได้ตั้ง CRON_SECRET", { status: 503 });
  if (!authorized(req.headers.get("authorization"))) return new Response("ไม่อนุญาต", { status: 401 });
  try {
    const report = await runFollowups();
    // ไม่คืนเนื้อหาข้อความลูกค้า — แค่ไอดีห้องกับเหตุผล
    return Response.json(report);
  } catch (err) {
    console.error(`[cron/followup] ล้ม: ${(err as Error).message}`);
    return new Response("ทำงานไม่สำเร็จ", { status: 500 });
  }
}
