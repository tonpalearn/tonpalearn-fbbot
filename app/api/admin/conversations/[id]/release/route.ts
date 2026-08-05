/**
 * คืนบทสนทนาให้บอตดูแลต่อ
 */
import { requireAdmin } from "@/lib/auth";
import { logHandoff, updateConversation } from "@/lib/store";
import { getConversationPsid } from "../../../_lib/data";
import { bad, fail, ok } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  try {
    const target = await getConversationPsid(id);
    if (!target) return bad("ไม่พบบทสนทนานี้", 404);

    await updateConversation(id, { state: "bot_active" });
    await logHandoff(id, "auto_release", "แอดมินคืนสายให้บอต", "admin");
  } catch (err) {
    return fail("release", err, "คืนสายให้บอตไม่สำเร็จ");
  }

  return ok({ ok: true, state: "bot_active" });
}
