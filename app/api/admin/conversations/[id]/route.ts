/** รายละเอียดบทสนทนาหนึ่งห้อง พร้อมข้อความทั้งหมด (เปิดแล้วถือว่าอ่านแล้ว) */
import { requireAdmin } from "@/lib/auth";
import { getConversation, markConversationRead } from "../../_lib/data";
import { bad, fail, ok } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) return bad("ไม่พบบทสนทนานี้", 404);

    await markConversationRead(id);
    // คืนออบเจกต์ตรง ๆ ตาม contract ใน SPEC §10 — ห้ามห่อด้วยคีย์อื่น หน้าเว็บอ่านตรงนี้
    return ok(convo);
  } catch (err) {
    return fail("conversation-detail", err, "เปิดบทสนทนาไม่สำเร็จ");
  }
}
