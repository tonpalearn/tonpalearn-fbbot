/**
 * "งานวันนี้" ของหน้าแรก — แชทรอคน → ผู้สนใจใหม่ → ร่างตามรอบ 2 ใกล้หมดเวลา + สถานะบอต 1 บรรทัด
 * ตรรกะจัดลำดับอยู่ที่ lib/today.ts (เทสต์ใน tests/today.test.ts) ที่นี่แค่ดึงข้อมูลมาป้อน
 */
import { requireAdmin } from "@/lib/auth";
import { buildTodayQueue } from "@/lib/today";
import { getBotStatus, listConversations, listNewLeads } from "../_lib/data";
import { fail, ok } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const now = new Date();
    const [conversations, leads, status] = await Promise.all([
      listConversations({ limit: 200 }),
      listNewLeads(100),
      getBotStatus(),
    ]);
    const queue = buildTodayQueue({ conversations, leads, now });
    return ok({ ...queue, status, generatedAt: now.toISOString() });
  } catch (err) {
    return fail("today", err, "ดึงงานวันนี้ไม่สำเร็จ");
  }
}
