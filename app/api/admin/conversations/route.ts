/** รายการบทสนทนา — กรองตามสถานะได้ */
import { requireAdmin } from "@/lib/auth";
import { isConversationState, listConversations } from "../_lib/data";
import { bad, fail, ok } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const stateParam = url.searchParams.get("state") ?? "";
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    if (stateParam !== "" && !isConversationState(stateParam)) {
      return bad("สถานะที่ขอมาไม่ถูกต้อง");
    }

    const items = await listConversations({
      state: stateParam === "" ? undefined : stateParam,
      limit,
    });
    return ok({ items });
  } catch (err) {
    return fail("conversations", err, "ดึงรายการบทสนทนาไม่สำเร็จ");
  }
}
