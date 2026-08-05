/**
 * แอดมินขอคุยเอง — ดึงสายกลับมาจาก Page Inbox แล้วสั่งให้บอตเงียบ
 */
import { requireAdmin } from "@/lib/auth";
import { takeThreadControl } from "@/lib/facebook";
import { logHandoff, updateConversation } from "@/lib/store";
import { getConversationPsid } from "../../../_lib/data";
import { bad, fail, ok } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  let target: { psid: string } | null;
  try {
    target = await getConversationPsid(id);
  } catch (err) {
    return fail("takeover-lookup", err, "อ่านข้อมูลบทสนทนาไม่สำเร็จ");
  }
  if (!target) return bad("ไม่พบบทสนทนานี้", 404);

  // ถ้าสายยังอยู่กับบอตอยู่แล้ว Facebook จะปฏิเสธ — ไม่ถือว่าเป็นความล้มเหลว
  let facebookNote: string | null = null;
  try {
    await takeThreadControl(target.psid, "แอดมินขอคุยเอง");
  } catch (err) {
    facebookNote =
      "Facebook ไม่ได้คืนสายให้ (มักเป็นเพราะสายอยู่กับแอปนี้อยู่แล้ว) แต่ตั้งสถานะให้บอตเงียบเรียบร้อย";
    console.error(`[admin:takeover] ${(err as Error).message}`);
  }

  try {
    await updateConversation(id, { state: "human_active", unread_for_admin: false });
    await logHandoff(id, "take", "แอดมินขอคุยเอง", "admin");
  } catch (err) {
    return fail("takeover-save", err, "บันทึกสถานะไม่สำเร็จ");
  }

  return ok({ ok: true, state: "human_active", note: facebookNote });
}
