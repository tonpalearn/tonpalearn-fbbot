/** ผู้สนใจที่บอตเก็บได้ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../_lib/data";
import { asInt, asTrimmed, fail, ok } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "contacted", "won", "lost"];

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const status = asTrimmed(url.searchParams.get("status"));
  const limit = Math.min(Math.max(asInt(url.searchParams.get("limit"), 200), 1), 1000);

  try {
    let q = db()
      .from("leads")
      .select("id,name,phone,email,interest,lead_type,status,note,created_at,conversation_id")
      .eq("page_id", pageId())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status !== "" && STATUSES.includes(status)) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;
    return ok({ items: data ?? [] });
  } catch (err) {
    return fail("leads-list", err, "อ่านรายชื่อผู้สนใจไม่สำเร็จ");
  }
}
