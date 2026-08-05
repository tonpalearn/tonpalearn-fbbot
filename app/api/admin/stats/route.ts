/** ตัวเลขสรุปหน้าแรก + บทสนทนาล่าสุด 10 รายการ */
import { requireAdmin } from "@/lib/auth";
import { getStats, listConversations } from "../_lib/data";
import { fail, ok } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const [stats, recent] = await Promise.all([getStats(), listConversations({ limit: 10 })]);
    return ok({ stats, recent });
  } catch (err) {
    return fail("stats", err, "ดึงตัวเลขสรุปไม่สำเร็จ");
  }
}
